import { Request, Response } from 'express';
import { uploadFile, getFileUrl } from '../integrations/storage/r2Service';
import prisma from '../utils/prisma';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

export const uploadCV = async (req: AuthRequest, res: Response) => {
  // @ts-ignore
  const userId = req.user!.id;

  if (!req.file) {
    throw new BadRequestError('No file provided');
  }

  const { buffer, mimetype, originalname } = req.file;

  const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allowedTypes.includes(mimetype)) {
    throw new BadRequestError('Invalid file type. Only PDF and Word documents are allowed.');
  }

  const fileKey = await uploadFile(buffer, mimetype, originalname, `cvs/${userId}`);

  const user = await prisma.user.update({
    where: { id: userId },
    data: { cvFileUrl: fileKey }
  });

  res.status(200).json({ message: 'CV uploaded successfully', cvFileUrl: fileKey });
};

export const getProtectedFile = async (req: AuthRequest, res: Response) => {
  const { key } = req.query;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;

  if (!key || typeof key !== 'string') {
    throw new BadRequestError('File key is required');
  }

  // Authorization logic
  // Admin can access any file.
  // Students can access their own CV or files from enrolled courses (e.g. assignments, materials).
  
  let isAuthorized = false;

  if (userRole === 'ADMIN') {
    isAuthorized = true;
  } else {
    // If it's a CV, check if it starts with cvs/{userId}
    if (key.startsWith(`cvs/${userId}/`)) {
      isAuthorized = true;
    }
    // TODO: Add logic for assignment submissions and course materials
    // For now, if we reach here and it's not their CV, we block unless we have specific logic
  }

  if (!isAuthorized) {
    throw new ForbiddenError('You are not authorized to access this file');
  }

  const url = await getFileUrl(key);
  res.status(200).json({ url });
};
