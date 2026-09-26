import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';
import { generateSecureVideoAccess } from '../services/videoService';

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
    // @ts-ignore
    const isEmailVerified = req.user!.isEmailVerified;
    if (!isEmailVerified) {
      throw new ForbiddenError('You must verify your email before accessing lessons');
    }

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

    // Security: Never return the permanent video URL to a student
    lesson.videoUrl = null;
  }

  res.status(200).json({ lesson });
};

export const getVideoAccess = async (req: AuthRequest, res: Response) => {
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

  if (lesson.type !== 'VIDEO' || !lesson.videoUrl) {
    throw new BadRequestError('This lesson does not contain a video');
  }

  if (userRole !== 'ADMIN') {
    // @ts-ignore
    const isEmailVerified = req.user!.isEmailVerified;
    if (!isEmailVerified) {
      throw new ForbiddenError('You must verify your email before accessing videos');
    }

    if (!lesson.isPublished) {
      throw new ForbiddenError('Lesson is not published');
    }

    const courseId = lesson.module.courseId;
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        userId_courseId: { userId, courseId }
      }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('Active enrollment required to access this video');
    }
  }

  const access = await generateSecureVideoAccess(lesson.videoUrl);
  // Return ONLY the short-lived access information
  res.status(200).json(access);
};
