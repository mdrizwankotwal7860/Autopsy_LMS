import { Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, ForbiddenError, BadRequestError, ConflictError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';
import { uploadFile, getFileUrl } from '../integrations/storage/r2Service';

const verifyRelationship = async (
  userId: string,
  userRole: string,
  courseId: string,
  moduleId: string,
  lessonId: string
) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: true,
      assignments: true
    }
  });

  if (!lesson || lesson.moduleId !== moduleId || lesson.module.courseId !== courseId) {
    throw new NotFoundError('Assignment not found');
  }

  if (lesson.type !== 'ASSIGNMENT') {
    throw new BadRequestError('This lesson is not an assignment');
  }

  if (userRole !== 'ADMIN') {
    // @ts-ignore
    // Email verification check would normally happen here if we passed it in, but authMiddleware adds req.user.isEmailVerified
    // Assuming authMiddleware covers basic auth, but we should check email verification if normally done
    // We'll trust the route middleware for now or check it from the user DB if strictly required.
    
    if (!lesson.isPublished) {
      throw new ForbiddenError('Assignment is not published');
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('Active enrollment required to access this assignment');
    }
  }

  const assignment = lesson.assignments[0];
  if (!assignment) {
    throw new NotFoundError('Assignment details not found');
  }

  return assignment;
};

export const getAssignment = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  // @ts-ignore
  const isEmailVerified = req.user!.isEmailVerified;

  if (userRole !== 'ADMIN' && !isEmailVerified) {
    throw new ForbiddenError('You must verify your email before accessing assignments');
  }

  const assignment = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  res.status(200).json({ assignment });
};

export const submitAssignment = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  // @ts-ignore
  const isEmailVerified = req.user!.isEmailVerified;

  if (userRole !== 'ADMIN' && !isEmailVerified) {
    throw new ForbiddenError('You must verify your email before submitting assignments');
  }

  const assignment = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  const { textAnswer } = req.body;
  let fileUrl: string | null = null;

  // Handle duplicate submission first
  const existingSubmission = await prisma.assignmentSubmission.findUnique({
    where: { userId_assignmentId: { userId, assignmentId: assignment.id } }
  });

  if (existingSubmission) {
    throw new ConflictError('You have already submitted this assignment');
  }

  if (req.file) {
    const { buffer, mimetype, originalname } = req.file;

    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain'
    ];
    
    if (!allowedTypes.includes(mimetype)) {
      throw new BadRequestError('Invalid file type. Only PDF, Word, and text documents are allowed.');
    }

    // Secure key generation
    const fileKey = `assignments/${assignment.id}/${userId}/${Date.now()}-${originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    fileUrl = await uploadFile(buffer, mimetype, originalname, fileKey);
  }

  if (!fileUrl && !textAnswer) {
    throw new BadRequestError('You must provide either a file or a text answer');
  }

  const submission = await prisma.assignmentSubmission.create({
    data: {
      assignmentId: assignment.id,
      userId,
      fileUrl,
      textAnswer,
      status: 'PENDING'
    }
  });

  // Do not expose raw fileUrl to student in response
  const responseSubmission = { ...submission, fileUrl: submission.fileUrl ? 'AVAILABLE_VIA_ENDPOINT' : null };

  res.status(201).json({ message: 'Assignment submitted successfully', submission: responseSubmission });
};

export const getSubmission = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  const assignment = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  const submission = await prisma.assignmentSubmission.findUnique({
    where: { userId_assignmentId: { userId, assignmentId: assignment.id } }
  });

  if (!submission) {
    throw new NotFoundError('Submission not found');
  }

  let presignedUrl = null;
  if (submission.fileUrl) {
    presignedUrl = await getFileUrl(submission.fileUrl);
  }

  const responseSubmission = { ...submission, fileUrl: submission.fileUrl ? 'AVAILABLE_VIA_ENDPOINT' : null };

  res.status(200).json({ submission: responseSubmission, downloadUrl: presignedUrl });
};

export const gradeSubmission = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId, submissionId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  if (userRole !== 'ADMIN') {
    throw new ForbiddenError('Only admins can grade assignments');
  }

  const assignment = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  const { marks, feedback } = req.body;

  if (marks !== undefined && assignment.maxMarks !== null && marks > assignment.maxMarks) {
    throw new BadRequestError(`Marks cannot exceed the maximum marks (${assignment.maxMarks})`);
  }

  const submission = await prisma.assignmentSubmission.findUnique({
    where: { id: submissionId }
  });

  if (!submission || submission.assignmentId !== assignment.id) {
    throw new NotFoundError('Submission not found');
  }

  const updatedSubmission = await prisma.assignmentSubmission.update({
    where: { id: submissionId },
    data: {
      marks,
      feedback,
      status: 'GRADED',
      gradedAt: new Date()
    }
  });

  const responseSubmission = { ...updatedSubmission, fileUrl: updatedSubmission.fileUrl ? 'AVAILABLE_VIA_ENDPOINT' : null };

  res.status(200).json({ message: 'Submission graded successfully', submission: responseSubmission });
};
