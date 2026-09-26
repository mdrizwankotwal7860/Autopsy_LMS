import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

export const createCourse = async (req: AuthRequest, res: Response) => {
  const { title, description, price, status } = req.body;

  const course = await prisma.course.create({
    data: { title, description, price, status }
  });

  res.status(201).json({ message: 'Course created successfully', course });
};

export const getCourses = async (req: AuthRequest, res: Response) => {
  // If user is admin, they can see all courses. Otherwise only PUBLISHED.
  // Wait, the route does not enforce authentication for GET / API, but we can check token if provided.
  // For simplicity, let's say public can only see published courses unless an admin token is passed.
  
  let filter = {};
  if (req.user?.role !== 'ADMIN') {
    filter = { status: 'PUBLISHED' };
  }

  const courses = await prisma.course.findMany({
    where: filter,
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: {
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              description: true,
              type: true,
              order: true,
              isPublished: true,
              moduleId: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  res.status(200).json({ courses });
};

export const getCourseById = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  let filter: any = { id };
  if (req.user?.role !== 'ADMIN') {
    filter.status = 'PUBLISHED';
  }

  const course = await prisma.course.findFirst({
    where: filter,
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: {
          lessons: {
            orderBy: { order: 'asc' },
            select: {
              id: true,
              title: true,
              description: true,
              type: true,
              order: true,
              isPublished: true,
              moduleId: true,
              createdAt: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  if (!course) {
    throw new NotFoundError('Course not found');
  }

  res.status(200).json({ course });
};

export const updateCourse = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const { title, description, price, status } = req.body;

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) {
    throw new NotFoundError('Course not found');
  }

  const updatedCourse = await prisma.course.update({
    where: { id },
    data: { title, description, price, status }
  });

  res.status(200).json({ message: 'Course updated successfully', course: updatedCourse });
};

export const deleteCourse = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  const course = await prisma.course.findUnique({ where: { id } });
  if (!course) {
    throw new NotFoundError('Course not found');
  }

  await prisma.course.delete({ where: { id } });

  res.status(200).json({ message: 'Course deleted successfully' });
};
