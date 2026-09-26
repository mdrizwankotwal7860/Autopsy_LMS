// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import * as jwt from '../src/utils/jwt';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('../src/utils/prisma', () => ({
  lesson: {
    findUnique: jest.fn(),
    findMany: jest.fn()
  },
  enrollment: {
    findUnique: jest.fn()
  },
  lessonProgress: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn()
  },
  user: {
    findUnique: jest.fn()
  }
}));

jest.mock('../src/utils/jwt', () => ({
  verifyToken: jest.fn()
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
const mockVerifyToken = jwt.verifyToken as jest.Mock;

describe('Progress Authorization API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupAuth = (userId: string, role: string) => {
    mockVerifyToken.mockReturnValue({ userId, role });
    (mockPrisma.user.findUnique as jest.Mock).mockResolvedValue({ id: userId, role, eligibilityStatus: 'APPROVED' });
  };

  describe('POST /api/progress', () => {
    const lessonId = 'lesson-1';
    const courseId = 'course-1';
    const userId = 'student-1';

    beforeEach(() => {
      (mockPrisma.lesson.findUnique as jest.Mock).mockResolvedValue({
        id: lessonId,
        module: { courseId }
      });
      (mockPrisma.lessonProgress.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.lessonProgress.create as jest.Mock).mockResolvedValue({ id: 'prog-1' });
    });

    it('enrolled student can update progress', async () => {
      setupAuth(userId, 'STUDENT');
      (mockPrisma.enrollment.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .post('/api/progress')
        .set('Authorization', 'Bearer dummy-token')
        .send({ lessonId, isCompleted: true });

      expect(res.status).toBe(200);
      expect(mockPrisma.enrollment.findUnique).toHaveBeenCalledWith({
        where: { userId_courseId: { userId, courseId } }
      });
    });

    it('non-enrolled student cannot update progress', async () => {
      setupAuth(userId, 'STUDENT');
      (mockPrisma.enrollment.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .post('/api/progress')
        .set('Authorization', 'Bearer dummy-token')
        .send({ lessonId, isCompleted: true });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('You must be actively enrolled to update progress');
    });

    it('student cannot manipulate another users progress', async () => {
      setupAuth(userId, 'STUDENT');
      (mockPrisma.enrollment.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });

      // The controller strictly uses req.user.id derived from the token for creating progress,
      // not accepting userId from the payload.
      await request(app)
        .post('/api/progress')
        .set('Authorization', 'Bearer dummy-token')
        .send({ lessonId, isCompleted: true, userId: 'other-student' });

      expect(mockPrisma.lessonProgress.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId // strictly matches the authenticated user, not the payload
          })
        })
      );
    });

    it('admin behavior remains correct', async () => {
      setupAuth('admin-1', 'ADMIN');
      // Admin doesn't need an enrollment record
      
      const res = await request(app)
        .post('/api/progress')
        .set('Authorization', 'Bearer dummy-token')
        .send({ lessonId, isCompleted: true });

      expect(res.status).toBe(200);
      expect(mockPrisma.enrollment.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/progress/course/:courseId', () => {
    const courseId = 'course-1';
    const userId = 'student-1';

    beforeEach(() => {
      (mockPrisma.lesson.findMany as jest.Mock).mockResolvedValue([{ id: 'lesson-1' }]);
      (mockPrisma.lessonProgress.count as jest.Mock).mockResolvedValue(1);
    });

    it('enrolled student can read progress', async () => {
      setupAuth(userId, 'STUDENT');
      (mockPrisma.enrollment.findUnique as jest.Mock).mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/progress/course/${courseId}`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(200);
      expect(res.body.progressPercentage).toBe(100);
    });

    it('non-enrolled student cannot read progress', async () => {
      setupAuth(userId, 'STUDENT');
      (mockPrisma.enrollment.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/progress/course/${courseId}`)
        .set('Authorization', 'Bearer dummy-token');

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('You must be actively enrolled to view progress');
    });
  });
});
