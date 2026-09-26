import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

export const createLesson = async (req: AuthRequest, res: Response) => {
  const { moduleId } = req.params;
  const { title, description, type, content, videoUrl, order, isPublished } = req.body;

  const module = await prisma.module.findUnique({ where: { id: moduleId } });
  if (!module) {
    throw new NotFoundError('Module not found');
  }

  const lesson = await prisma.lesson.create({
    data: {
      title,
      description,
      type,
      content,
      videoUrl,
      order,
      isPublished,
      moduleId
    }
  });

  res.status(201).json({ message: 'Lesson created successfully', lesson });
};

export const updateLesson = async (req: AuthRequest, res: Response) => {
  const { moduleId, lessonId } = req.params;
  const { title, description, type, content, videoUrl, order, isPublished } = req.body;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId, moduleId }
  });

  if (!lesson) {
    throw new NotFoundError('Lesson not found');
  }

  const updatedLesson = await prisma.lesson.update({
    where: { id: lessonId },
    data: { title, description, type, content, videoUrl, order, isPublished }
  });

  res.status(200).json({ message: 'Lesson updated successfully', lesson: updatedLesson });
};

export const deleteLesson = async (req: AuthRequest, res: Response) => {
  const { moduleId, lessonId } = req.params;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId, moduleId }
  });

  if (!lesson) {
    throw new NotFoundError('Lesson not found');
  }

  await prisma.lesson.delete({ where: { id: lessonId } });

  res.status(200).json({ message: 'Lesson deleted successfully' });
};

export const getLesson = async (req: AuthRequest, res: Response) => {
  const { moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId, moduleId },
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
    if (!lesson.isPublished) {
      throw new ForbiddenError('Lesson is not published');
    }

    // Check enrollment
    const courseId = lesson.module.courseId;
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId }
      }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('Active enrollment required to access this lesson');
    }
  }

  res.status(200).json({ lesson });
};
