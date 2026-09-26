import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('uuid', () => ({ v4: jest.fn() }));

jest.mock('../src/utils/prisma', () => ({
  course: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
  user: {
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
  },
  enrollment: {
    findMany: jest.fn(),
    count: jest.fn(),
  }
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('P2 Pagination and Payload Size Hardening', () => {
  let adminToken: string;
  let studentToken: string;

  beforeEach(() => {
    jest.clearAllMocks();
    const secret = process.env.JWT_SECRET || 'super-secret-jwt-key';
    adminToken = jwt.sign({ userId: 'admin-1', role: 'ADMIN' }, secret);
    studentToken = jwt.sign({ userId: 'student-1', role: 'STUDENT' }, secret);
    
    // Mock for authMiddleware
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'admin-1',
      role: 'ADMIN',
      isEmailVerified: true
    } as any);
  });

  describe('GET /api/courses', () => {
    const mockCourses = [
      { id: '1', title: 'Course 1', status: 'PUBLISHED' },
      { id: '2', title: 'Course 2', status: 'PUBLISHED' }
    ];

    it('1. Returns default pagination format and limits', async () => {
      mockPrisma.course.count.mockResolvedValue(50);
      mockPrisma.course.findMany.mockResolvedValue(mockCourses as any);

      const res = await request(app).get('/api/courses');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 50,
        totalPages: 3
      });
      
      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20, orderBy: { createdAt: 'desc' } })
      );
      
      // Ensure relations are NOT loaded
      const findManyCall = mockPrisma.course.findMany.mock.calls[0][0];
      expect(findManyCall?.include).toBeUndefined();
    });

    it('2. Enforces maximum limit (100)', async () => {
      mockPrisma.course.count.mockResolvedValue(50);
      mockPrisma.course.findMany.mockResolvedValue(mockCourses as any);

      const res = await request(app).get('/api/courses?limit=1000');

      expect(res.statusCode).toBe(200);
      expect(res.body.pagination.limit).toBe(100);
      expect(mockPrisma.course.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 })
      );
    });

    it('3. Rejects invalid pagination values with fallbacks', async () => {
      mockPrisma.course.count.mockResolvedValue(50);
      mockPrisma.course.findMany.mockResolvedValue(mockCourses as any);

      const res = await request(app).get('/api/courses?page=-5&limit=0');

      expect(res.statusCode).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.limit).toBe(20);
    });
  });

  describe('GET /api/users', () => {
    const mockUsers = [
      { id: 'u1', name: 'User 1', email: 'u1@test.com' },
      { id: 'u2', name: 'User 2', email: 'u2@test.com' }
    ];

    it('4. Admin can access with pagination', async () => {
      mockPrisma.user.count.mockResolvedValue(10);
      mockPrisma.user.findMany.mockResolvedValue(mockUsers as any);

      const res = await request(app)
        .get('/api/users?page=2&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(mockUsers);
      expect(res.body.pagination).toEqual({
        page: 2,
        limit: 5,
        total: 10,
        totalPages: 2
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 5, take: 5, orderBy: { createdAt: 'desc' } })
      );
    });

    it('5. Non-admin is blocked', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'student-1',
        role: 'STUDENT',
        isEmailVerified: true
      } as any);
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(403);
    });
  });

  describe('GET /api/enrollments', () => {
    const mockEnrollments = [
      { id: 'e1', userId: 'u1', courseId: 'c1' },
      { id: 'e2', userId: 'u2', courseId: 'c2' }
    ];

    it('6. Admin can access with pagination and relation selection', async () => {
      mockPrisma.enrollment.count.mockResolvedValue(15);
      mockPrisma.enrollment.findMany.mockResolvedValue(mockEnrollments as any);

      const res = await request(app)
        .get('/api/enrollments?page=1&limit=10')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual(mockEnrollments);
      expect(res.body.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 15,
        totalPages: 2
      });

      expect(mockPrisma.enrollment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10, orderBy: { createdAt: 'desc' } })
      );
    });

    it('7. Non-admin is blocked from full list, but can access their own via ID/filter (existing logic)', async () => {
      // Actually, enrollmentController sets filter = { userId } for students, meaning they CAN access getEnrollments but only see theirs!
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'student-1',
        role: 'STUDENT',
        isEmailVerified: true
      } as any);
      mockPrisma.enrollment.count.mockResolvedValue(2);
      mockPrisma.enrollment.findMany.mockResolvedValue([mockEnrollments[0]] as any);

      const res = await request(app)
        .get('/api/enrollments')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.data.length).toBe(1);
    });
  });
});
