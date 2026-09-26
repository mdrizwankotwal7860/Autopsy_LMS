// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import * as emailService from '../src/utils/emailService';

const VALID_JWT_SECRET = 'test_secret_for_jwt_which_must_exist';

beforeAll(() => {
  process.env.JWT_SECRET = VALID_JWT_SECRET;
});

jest.mock('../src/utils/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  verificationToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn()
  },
  passwordResetToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn()
  },
  refreshToken: {
    create: jest.fn(),
    updateMany: jest.fn()
  },
  $transaction: jest.fn((ops) => Promise.all(ops))
}));

jest.mock('../src/utils/emailService', () => ({
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined)
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Email & Password Security API (P1-D)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    passwordHash: 'hashed-password',
    name: 'Test Student',
    role: 'STUDENT',
    eligibilityStatus: 'APPROVED',
    isEmailVerified: false
  };

  describe('Email Verification', () => {
    it('Registration creates unverified user and generates token', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue(mockUser);
      mockPrisma.verificationToken.create.mockResolvedValue({});

      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'test@example.com', password: 'password123', name: 'Test' });

      expect(res.statusCode).toBe(201);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isEmailVerified: false }) })
      );
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', expect.any(String));
    });

    it('Valid token verifies account', async () => {
      const plaintextToken = 'valid_token';
      const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');

      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: mockUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 100000),
        user: mockUser
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: plaintextToken });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockUser.id }, data: { isEmailVerified: true } })
      );
      expect(mockPrisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
    });

    it('Invalid token rejected', async () => {
      mockPrisma.verificationToken.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: 'invalid_token' });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid/);
    });

    it('Expired token rejected', async () => {
      const plaintextToken = 'expired_token';
      const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');

      mockPrisma.verificationToken.findUnique.mockResolvedValue({
        id: 'vt-1',
        userId: mockUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() - 100000), // expired
        user: mockUser
      });

      const res = await request(app)
        .post('/api/auth/verify-email')
        .send({ token: plaintextToken });

      expect(res.statusCode).toBe(400);
      expect(mockPrisma.verificationToken.delete).toHaveBeenCalledWith({ where: { id: 'vt-1' } });
    });

    it('Resend verification works and hides enumeration', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'test@example.com' });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.verificationToken.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.verificationToken.create).toHaveBeenCalled();
      expect(emailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('Resend verification on unknown email hides enumeration', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unknown@example.com' });

      expect(res.statusCode).toBe(200); // Does not reveal user absence
      expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe('Password Reset', () => {
    it('Forgot password known email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'test@example.com' });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.passwordResetToken.deleteMany).toHaveBeenCalled();
      expect(mockPrisma.passwordResetToken.create).toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalled();
    });

    it('Forgot password unknown email (consistent response)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'unknown@example.com' });

      expect(res.statusCode).toBe(200);
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('Valid reset token changes password and revokes all refresh sessions', async () => {
      const plaintextToken = 'valid_reset_token';
      const tokenHash = crypto.createHash('sha256').update(plaintextToken).digest('hex');

      mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: mockUser.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 100000)
      });

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: plaintextToken, newPassword: 'newsecurepassword' });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: mockUser.id }, data: { passwordHash: expect.any(String) } })
      );
      expect(mockPrisma.passwordResetToken.delete).toHaveBeenCalledWith({ where: { id: 'prt-1' } });
      
      // CRITICAL SECURITY: All refresh tokens MUST be revoked
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockUser.id },
        data: { isRevoked: true }
      });
    });
  });
});
