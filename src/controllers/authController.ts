import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { generateToken, generateRefreshToken, hashToken } from '../utils/jwt';
import { BadRequestError, UnauthorizedError, ConflictError } from '../utils/errors';
import { sendVerificationEmail, sendPasswordResetEmail } from '../utils/emailService';

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
      isEmailVerified: false,
    }
  });

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt
    }
  });

  await sendVerificationEmail(user.email, verificationToken);

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

export const verifyEmail = async (req: Request, res: Response) => {
  const { token } = req.body;
  if (!token) throw new BadRequestError('Token is required');

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.verificationToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!record) {
    throw new BadRequestError('Invalid or expired verification token');
  }

  if (record.expiresAt < new Date()) {
    await prisma.verificationToken.delete({ where: { id: record.id } });
    throw new BadRequestError('Verification token expired');
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { isEmailVerified: true }
    }),
    prisma.verificationToken.delete({ where: { id: record.id } })
  ]);

  res.status(200).json({ message: 'Email verified successfully' });
};

export const resendVerification = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) throw new BadRequestError('Email is required');

  const user = await prisma.user.findUnique({ where: { email } });
  
  // Anti-enumeration: always return same response
  if (!user || user.isEmailVerified) {
    return res.status(200).json({ message: 'If the email is registered and unverified, a verification link has been sent.' });
  }

  const verificationToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Remove old tokens
  await prisma.verificationToken.deleteMany({ where: { userId: user.id } });

  await prisma.verificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt
    }
  });

  await sendVerificationEmail(user.email, verificationToken);

  res.status(200).json({ message: 'If the email is registered and unverified, a verification link has been sent.' });
};

export const forgotPassword = async (req: Request, res: Response) => {
  const { email } = req.body;
  if (!email) throw new BadRequestError('Email is required');

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Anti-enumeration
    return res.status(200).json({ message: 'If that email address is registered, a password reset link has been sent.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Delete old reset tokens
  await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt
    }
  });

  await sendPasswordResetEmail(user.email, resetToken);

  res.status(200).json({ message: 'If that email address is registered, a password reset link has been sent.' });
};

export const resetPassword = async (req: Request, res: Response) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) throw new BadRequestError('Token and new password are required');

  if (newPassword.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters long');
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash }
  });

  if (!record || record.expiresAt < new Date()) {
    if (record) await prisma.passwordResetToken.delete({ where: { id: record.id } });
    throw new BadRequestError('Invalid or expired reset token');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash }
    }),
    prisma.passwordResetToken.delete({ where: { id: record.id } }),
    // Revoke ALL existing refresh tokens for this user
    prisma.refreshToken.updateMany({
      where: { userId: record.userId },
      data: { isRevoked: true }
    })
  ]);

  res.status(200).json({ message: 'Password has been reset successfully. You have been logged out of all devices.' });
};

