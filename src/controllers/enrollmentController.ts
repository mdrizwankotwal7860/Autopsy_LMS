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

  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const [total, enrollments] = await Promise.all([
    prisma.enrollment.count({ where: filter }),
    prisma.enrollment.findMany({
      where: filter,
      skip,
      take: limit,
      include: {
        course: {
          select: { id: true, title: true, status: true }
        },
        user: userRole === 'ADMIN' ? { select: { id: true, name: true, email: true } } : false
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  res.status(200).json({
    data: enrollments,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  });
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
