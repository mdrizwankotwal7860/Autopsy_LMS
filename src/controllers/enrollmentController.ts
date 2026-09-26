import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

export const getEnrollments = async (req: AuthRequest, res: Response) => {
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  // Admins can see all enrollments, students only their own
  let filter = {};
  if (userRole !== 'ADMIN') {
    filter = { userId };
  } else if (req.query.userId) {
    filter = { userId: req.query.userId as string };
  }

  const enrollments = await prisma.enrollment.findMany({
    where: filter,
    include: {
      course: {
        select: { id: true, title: true, status: true }
      },
      user: userRole === 'ADMIN' ? { select: { id: true, name: true, email: true } } : false
    },
    orderBy: { createdAt: 'desc' }
  });

  res.status(200).json({ enrollments });
};

export const getEnrollmentById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  const enrollment = await prisma.enrollment.findUnique({
    where: { id },
    include: {
      course: {
        include: {
          modules: {
            orderBy: { order: 'asc' },
            include: { lessons: { orderBy: { order: 'asc' } } }
          }
        }
      }
    }
  });

  if (!enrollment) {
    throw new NotFoundError('Enrollment not found');
  }

  if (userRole !== 'ADMIN' && enrollment.userId !== userId) {
    throw new ForbiddenError('You do not have access to this enrollment');
  }

  res.status(200).json({ enrollment });
};
