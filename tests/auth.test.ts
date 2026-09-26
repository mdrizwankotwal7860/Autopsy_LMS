// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const VALID_JWT_SECRET = 'test_secret_for_jwt_which_must_exist';

beforeAll(() => {
  process.env.JWT_SECRET = VALID_JWT_SECRET;
});

jest.mock('../src/utils/prisma', () => ({
  user: {
    findUnique: jest.fn(),
    create: jest.fn()
  },
  refreshToken: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn()
  }
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('Authentication API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const mockUser = {
    id: 'user-1',
    email: 'student@example.com',
    passwordHash: 'hashed-password',
    name: 'Test Student',
    role: 'STUDENT',
    eligibilityStatus: 'APPROVED'
  };

  const mockAdmin = {
    id: 'admin-1',
    email: 'admin@example.com',
    passwordHash: 'hashed-password',
    name: 'Admin',
    role: 'ADMIN',
    eligibilityStatus: 'APPROVED'
  };

  it('Login creates access + refresh session', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@example.com', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(res.body.token).toBeDefined();
    
    // Check for cookie
    const setCookieHeader = res.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader[0]).toMatch(/refreshToken=.*HttpOnly/i);
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it('Student authentication works (role returned)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@example.com', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(res.body.user.role).toBe('STUDENT');
  });

  it('Admin authentication works', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'password123' });

    expect(res.statusCode).toBe(200);
    expect(res.body.user.role).toBe('ADMIN');
  });

  it('Valid access token works', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    mockPrisma.refreshToken.create.mockResolvedValue({});

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@example.com', password: 'password123' });
    
    const token = loginRes.body.token;

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    
    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.user.email).toBe('student@example.com');
  });

  it('Expired access token fails', async () => {
    // Manually sign an expired token
    const expiredToken = jwt.sign({ userId: 'user-1', role: 'STUDENT' }, VALID_JWT_SECRET, { expiresIn: '-1h' });

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);
    
    expect(meRes.statusCode).toBe(401);
  });

  it('Valid refresh token creates new access token (refresh token rotates)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser);
    jest.spyOn(bcrypt, 'compare').mockResolvedValue(true);
    
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@example.com', password: 'password123' });
    
    const cookies = loginRes.headers['set-cookie'];

    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      familyId: 'family-1',
      tokenHash: 'some-hash',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 100000),
      user: mockUser
    });

    mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies);
    
    expect(refreshRes.statusCode).toBe(200);
    expect(refreshRes.body.token).toBeDefined();

    // Should give a new cookie
    const newCookies = refreshRes.headers['set-cookie'];
    expect(newCookies[0]).not.toBe(cookies[0]);
    // It should update the old token to be revoked
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ 
        where: { id: 'token-1', isRevoked: false },
        data: { isRevoked: true } 
      })
    );
    // It should create a new token
    expect(mockPrisma.refreshToken.create).toHaveBeenCalled();
  });

  it('Expired refresh token fails', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      familyId: 'family-1',
      tokenHash: 'some-hash',
      isRevoked: false,
      expiresAt: new Date(Date.now() - 100000), // Expired!
      user: mockUser
    });

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=valid_format_but_expired_in_db']);
    
    expect(refreshRes.statusCode).toBe(401);
    expect(refreshRes.body.error.message).toMatch(/expired/i);
  });

  it('Old refresh token cannot be reused (reuse of rotated token triggers session-family revocation)', async () => {
    // Mock token found but already revoked
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      familyId: 'family-1',
      tokenHash: 'some-hash',
      isRevoked: true, // Replay detected!
      expiresAt: new Date(Date.now() + 100000),
      user: mockUser
    });

    const reusedRefreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=stolen_old_token']);
    
    expect(reusedRefreshRes.statusCode).toBe(401);
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1' },
      data: { isRevoked: true }
    });
  });

  it('Revoked session cannot refresh', async () => {
    // Similar to above, when a whole family is revoked, all its tokens have isRevoked = true
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-2',
      familyId: 'family-1',
      tokenHash: 'some-hash2',
      isRevoked: true, 
      expiresAt: new Date(Date.now() + 100000),
      user: mockUser
    });

    const refreshRes = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', ['refreshToken=some_token']);
    
    expect(refreshRes.statusCode).toBe(401);
  });

  it('Logout revokes the session', async () => {
    mockPrisma.refreshToken.findUnique.mockResolvedValue({
      id: 'token-1',
      familyId: 'family-1',
      tokenHash: 'some-hash',
      isRevoked: false,
      expiresAt: new Date(Date.now() + 100000),
      user: mockUser
    });

    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', ['refreshToken=valid_token']);
    
    expect(logoutRes.statusCode).toBe(200);
    
    expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { familyId: 'family-1' },
      data: { isRevoked: true }
    });
    
    // Test that the cookie is cleared
    const setCookie = logoutRes.headers['set-cookie'];
    expect(setCookie[0]).toMatch(/refreshToken=;/i);
  });
});
