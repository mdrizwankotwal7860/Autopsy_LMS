import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { generateToken, generateRefreshToken, hashToken } from '../utils/jwt';
import { BadRequestError, UnauthorizedError, ConflictError } from '../utils/errors';

const REFRESH_TOKEN_COOKIE_NAME = 'refreshToken';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;

const setRefreshTokenCookie = (res: Response, token: string) => {
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  });
};

const createAndStoreRefreshToken = async (userId: string, familyId?: string): Promise<string> => {
  const refreshToken = generateRefreshToken();
  const tokenHash = hashToken(refreshToken);
  const finalFamilyId = familyId || crypto.randomUUID();
  
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await prisma.refreshToken.create({
    data: {
      userId,
      familyId: finalFamilyId,
      tokenHash,
      expiresAt,
    }
  });

  return refreshToken;
};

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
  const refreshToken = await createAndStoreRefreshToken(user.id);
  setRefreshTokenCookie(res, refreshToken);

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
  const refreshToken = await createAndStoreRefreshToken(user.id);
  setRefreshTokenCookie(res, refreshToken);

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

export const refresh = async (req: Request, res: Response) => {
  const incomingToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
  if (!incomingToken) {
    throw new UnauthorizedError('No refresh token provided');
  }

  const tokenHash = hashToken(incomingToken);

  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!storedToken) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // Reuse detection: if the token is already revoked, it's a replay attack.
  if (storedToken.isRevoked) {
    // Revoke the entire token family
    await prisma.refreshToken.updateMany({
      where: { familyId: storedToken.familyId },
      data: { isRevoked: true }
    });
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
    throw new UnauthorizedError('Security Warning: Refresh token reuse detected. Session terminated.');
  }

  if (storedToken.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Attempt to atomically mark the token as revoked
  const updateResult = await prisma.refreshToken.updateMany({ 
    where: { id: storedToken.id, isRevoked: false },
    data: { isRevoked: true }
  });

  if (updateResult.count === 0) {
    // We lost the race! A concurrent request already revoked it. Treat as replay.
    await prisma.refreshToken.updateMany({
      where: { familyId: storedToken.familyId },
      data: { isRevoked: true }
    });
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME);
    throw new UnauthorizedError('Security Warning: Refresh token reuse detected concurrently. Session terminated.');
  }

  const newAccessToken = generateToken({ userId: storedToken.user.id, role: storedToken.user.role });
  const newRefreshToken = await createAndStoreRefreshToken(storedToken.user.id, storedToken.familyId);
  setRefreshTokenCookie(res, newRefreshToken);

  res.status(200).json({
    token: newAccessToken
  });
};

export const logout = async (req: Request, res: Response) => {
  const incomingToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
  
  if (incomingToken) {
    const tokenHash = hashToken(incomingToken);
    try {
      // Find the token to get its familyId, and revoke the whole family
      const storedToken = await prisma.refreshToken.findUnique({ where: { tokenHash } });
      if (storedToken) {
        await prisma.refreshToken.updateMany({
          where: { familyId: storedToken.familyId },
          data: { isRevoked: true }
        });
      }
    } catch (e) {
      // Ignore if it doesn't exist
    }
  }

  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });

  res.status(200).json({ message: 'Logged out successfully' });
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
