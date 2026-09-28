import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateCertificatePDF } from '../utils/pdfGenerator';
import { uploadFile, getFileUrl } from '../integrations/storage/r2Service';
import crypto from 'crypto';
import redisClient, { redisEnabled } from '../utils/redis';
import { ConflictError } from '../utils/errors';

// Helper to generate a cryptographically safe unique ID
const generateUniqueId = () => {
  return crypto.randomBytes(16).toString('hex');
};

export const generateCertificate = async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { courseId } = req.params;

  // Verify enrollment
  const enrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
  });

  if (!enrollment) {
    throw new ForbiddenError('Not enrolled in this course');
  }

  // Verify exam passed
  // We need to check if they passed the final exam for the course
  // The structure is Course -> Modules -> Lessons -> Exams -> ExamAttempts
  const passedExamAttempt = await prisma.examAttempt.findFirst({
    where: {
      userId,
      exam: {
        lesson: {
          module: {
            courseId
          }
        }
      },
      passed: true
    },
    include: {
      exam: {
        include: {
          lesson: {
            include: {
              module: {
                include: {
                  course: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!passedExamAttempt) {
    throw new ForbiddenError('Course requirements not met. You must pass the final exam to generate a certificate.');
  }

  const course = passedExamAttempt.exam.lesson.module.course;

  const lockKey = `certificate-generation:${userId}:${courseId}`;
  const lockToken = generateUniqueId();

  if (redisEnabled && redisClient) {
    const acquired = await redisClient.set(lockKey, lockToken, 'EX', 30, 'NX');
    if (!acquired) {
      throw new ConflictError('Certificate generation already in progress');
    }
  }

  try {
    // Check if certificate already exists
  let certificate = await prisma.certificate.findFirst({
    where: {
      userId,
      courseId
    }
  });

  if (!certificate) {
    // Generate new certificate
    const uniqueId = generateUniqueId();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');

    const pdfBuffer = await generateCertificatePDF({
      studentName: user.name || 'Student',
      courseName: course.title,
      completionDate: new Date().toLocaleDateString('en-GB'),
      certificateId: uniqueId,
      institution: user.organization || 'Virtual Academy'
    });

    const fileKey = await uploadFile(pdfBuffer, 'application/pdf', `certificate_${uniqueId}.pdf`, `certificates/${userId}`);

    certificate = await prisma.certificate.create({
      data: {
        userId,
        courseId,
        uniqueId,
        fileUrl: fileKey
      }
    });
  }

    res.status(201).json({
      message: 'Certificate generated successfully',
      certificate: {
        id: certificate.id,
        uniqueId: certificate.uniqueId,
        issuedAt: certificate.issuedAt,
        courseId: certificate.courseId
      }
    });
  } finally {
    if (redisEnabled && redisClient) {
      const currentToken = await redisClient.get(lockKey);
      if (currentToken === lockToken) {
        await redisClient.del(lockKey);
      }
    }
  }
};

export const listCertificates = async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;

  const certificates = await prisma.certificate.findMany({
    where: { userId },
    include: {
      course: {
        select: {
          title: true
        }
      }
    },
    orderBy: { issuedAt: 'desc' }
  });

  res.status(200).json(certificates.map(cert => ({
    id: cert.id,
    uniqueId: cert.uniqueId,
    issuedAt: cert.issuedAt,
    courseTitle: cert.course.title
  })));
};

export const getCertificate = async (req: AuthRequest, res: Response) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: {
      course: {
        select: {
          title: true
        }
      },
      user: {
        select: {
          name: true
        }
      }
    }
  });

  if (!certificate) {
    throw new NotFoundError('Certificate not found');
  }

  if (certificate.userId !== userId && req.user!.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have access to this certificate');
  }

  // If there's an R2 fileUrl, generate a signed URL
  let downloadUrl = null;
  if (certificate.fileUrl) {
    downloadUrl = await getFileUrl(certificate.fileUrl);
  }

  res.status(200).json({
    id: certificate.id,
    uniqueId: certificate.uniqueId,
    issuedAt: certificate.issuedAt,
    courseTitle: certificate.course.title,
    studentName: certificate.user.name,
    downloadUrl
  });
};

export const verifyCertificate = async (req: Request, res: Response) => {
  const { uniqueId } = req.params;

  const certificate = await prisma.certificate.findUnique({
    where: { uniqueId },
    include: {
      user: {
        select: {
          name: true
        }
      },
      course: {
        select: {
          title: true
        }
      }
    }
  });

  if (!certificate) {
    throw new NotFoundError('Invalid certificate ID');
  }

  res.status(200).json({
    valid: true,
    certificate: {
      uniqueId: certificate.uniqueId,
      issuedAt: certificate.issuedAt,
      studentName: certificate.user.name,
      courseTitle: certificate.course.title
    }
  });
};
