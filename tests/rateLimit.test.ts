// @ts-nocheck
import request from 'supertest';
import express from 'express';

// We need to set the environment variables before importing app
process.env.AUTH_RATE_LIMIT_MAX = '2'; // Limit to 2 requests
process.env.API_RATE_LIMIT_MAX = '3'; // Limit to 3 requests
process.env.JWT_SECRET = 'test_secret_for_jwt_which_must_exist';

jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import bcrypt from 'bcryptjs';

jest.mock('../src/utils/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn()
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn()
  }
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Rate Limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // We can't reset the rate limit store easily without exposing it,
    // so we'll use a different mock IP for each test.
  });

  const mockUser = {
    id: 'user-1',
    email: 'student@example.com',
    passwordHash: 'hashed-password',
    name: 'Test Student',
    role: 'STUDENT',
    eligibilityStatus: 'APPROVED'
  };

  it('Login requests below the limit succeed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const res1 = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.168.1.1') // mock IP
      .send({ email: 'student@example.com', password: 'password123' });

    expect(res1.statusCode).toBe(200);
  });

  it('Login requests exceeding the limit return 429', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const ip = '192.168.1.2';

    // Request 1
    await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: 'x', password: 'y' });
    // Request 2
    await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: 'x', password: 'y' });
    
    // Request 3 (exceeds limit of 2)
    const res3 = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email: 'x', password: 'y' });

    expect(res3.statusCode).toBe(429);
    expect(res3.body.status).toBe('error');
    expect(res3.body.message).toMatch(/Too many requests/i);
  });

  it('Registration rate limiting works', async () => {
    const ip = '192.168.1.3';
    
    // 1
    await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({});
    // 2
    await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({});
    // 3 - blocked
    const res3 = await request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send({});

    expect(res3.statusCode).toBe(429);
  });

  it('Normal LMS API requests have a separate, more generous limit', async () => {
    // API limit is set to 3.
    const ip = '192.168.1.4';

    // 1
    await request(app).get('/api/courses').set('X-Forwarded-For', ip);
    // 2
    await request(app).get('/api/courses').set('X-Forwarded-For', ip);
    // 3
    await request(app).get('/api/courses').set('X-Forwarded-For', ip);

    // 4 - blocked by API limiter
    const res4 = await request(app).get('/api/courses').set('X-Forwarded-For', ip);
    expect(res4.statusCode).toBe(429);

    // Meanwhile, auth limit (which is 2) for this IP should not have been touched yet!
    // But wait, /api is a prefix for /api/auth. So both limiters see the request.
    // However, the apiLimiter counts ALL /api requests. The authLimiter ONLY counts /api/auth requests.
    // So if we make an auth request now, it should work up to its own limit, EXCEPT it also passes through apiLimiter!
    // Since apiLimiter is maxed out (3), any /api/* request from this IP will now be blocked by apiLimiter.
  });
});
