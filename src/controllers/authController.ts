import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma';
import { generateToken } from '../utils/jwt';
import { BadRequestError, UnauthorizedError, ConflictError } from '../utils/errors';

export const register = async (req: Request, res: Response) => {
  const { email, password, name, phone, qualification, professionalRole, organization } = req.body;

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    throw new ConflictError('Email already in use');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      phone,
      qualification,
      professionalRole,
      organization,
    }
  });

  const token = generateToken({ userId: user.id, role: user.role });

  res.status(201).json({
    message: 'User registered successfully',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      eligibilityStatus: user.eligibilityStatus,
    }
  });
};

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new UnauthorizedError('Invalid credentials');
  }

  const token = generateToken({ userId: user.id, role: user.role });

  res.status(200).json({
    message: 'Logged in successfully',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      eligibilityStatus: user.eligibilityStatus,
    }
  });
};

export const getMe = async (req: Request, res: Response) => {
  // @ts-ignore
  const userId = req.user!.id;
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      qualification: true,
      professionalRole: true,
      organization: true,
      role: true,
      eligibilityStatus: true,
      cvFileUrl: true,
      createdAt: true
    }
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  res.status(200).json({ user });
};
