import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

export const createModule = async (req: AuthRequest, res: Response) => {
  const { courseId } = req.params;
  const { title, description, order } = req.body;

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) {
    throw new NotFoundError('Course not found');
  }

  const module = await prisma.module.create({
    data: {
      title,
      description,
      order,
      courseId
    }
  });

  res.status(201).json({ message: 'Module created successfully', module });
};

export const updateModule = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId } = req.params;
  const { title, description, order } = req.body;

  const module = await prisma.module.findUnique({
    where: { id: moduleId, courseId }
  });

  if (!module) {
    throw new NotFoundError('Module not found');
  }

  const updatedModule = await prisma.module.update({
    where: { id: moduleId },
    data: { title, description, order }
  });

  res.status(200).json({ message: 'Module updated successfully', module: updatedModule });
};

export const deleteModule = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId } = req.params;

  const module = await prisma.module.findUnique({
    where: { id: moduleId, courseId }
  });

  if (!module) {
    throw new NotFoundError('Module not found');
  }

  await prisma.module.delete({ where: { id: moduleId } });

  res.status(200).json({ message: 'Module deleted successfully' });
};
