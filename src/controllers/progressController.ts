import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { AuthRequest } from '../middleware/authMiddleware';
import { NotFoundError, ForbiddenError } from '../utils/errors';

export const updateProgress = async (req: AuthRequest, res: Response) => {
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  const { lessonId, isCompleted, lastWatched } = req.body;

  const lesson = await prisma.lesson.findUnique({ 
    where: { id: lessonId },
    include: {
      module: {
        select: { courseId: true }
      }
    }
  });

  if (!lesson) {
    throw new NotFoundError('Lesson not found');
  }

  if (userRole !== 'ADMIN') {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId: lesson.module.courseId }
      }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('You must be actively enrolled to update progress');
    }
  }

  let progress = await prisma.lessonProgress.findUnique({
    where: { userId_lessonId: { userId, lessonId } }
  });

  if (!progress) {
    progress = await prisma.lessonProgress.create({
      data: {
        userId,
        lessonId,
        isCompleted: isCompleted || false,
        completedAt: isCompleted ? new Date() : null,
        lastWatched
      }
    });
  } else {
    progress = await prisma.lessonProgress.update({
      where: { id: progress.id },
      data: {
        isCompleted: isCompleted !== undefined ? isCompleted : progress.isCompleted,
        completedAt: isCompleted && !progress.isCompleted ? new Date() : progress.completedAt,
        lastWatched: lastWatched !== undefined ? lastWatched : progress.lastWatched
      }
    });
  }

  res.status(200).json({ progress });
};

export const getCourseProgress = async (req: AuthRequest, res: Response) => {
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  const courseId = req.params.courseId as string;

  if (userRole !== 'ADMIN') {
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId }
      }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('You must be actively enrolled to view progress');
    }
  }

  const lessons = await prisma.lesson.findMany({
    where: {
      module: { courseId },
      isPublished: true
    },
    select: { id: true }
  });

  const totalLessons = lessons.length;
  if (totalLessons === 0) {
    return res.status(200).json({ progressPercentage: 0, completedLessons: 0, totalLessons: 0 });
  }

  const lessonIds = lessons.map((l: any) => l.id);

  const completedProgress = await prisma.lessonProgress.count({
    where: {
      userId,
      lessonId: { in: lessonIds },
      isCompleted: true
    }
  });

  const progressPercentage = Math.round((completedProgress / totalLessons) * 100);

  res.status(200).json({
    progressPercentage,
    completedLessons: completedProgress,
    totalLessons
  });
};
