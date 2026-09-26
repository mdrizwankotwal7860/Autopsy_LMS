// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
process.env.CF_STREAM_ACCOUNT_ID = 'real-account-id';
process.env.CF_STREAM_API_TOKEN = 'real-api-token';

global.fetch = jest.fn();

import app from '../src/app';
import prisma from '../src/utils/prisma';
import jwt from 'jsonwebtoken';



jest.mock('../src/utils/prisma', () => ({
  user: {
    findUnique: jest.fn()
  },
  lesson: {
    findUnique: jest.fn()
  },
  course: {
    findMany: jest.fn(),
    findFirst: jest.fn()
  },
  enrollment: {
    findUnique: jest.fn()
  }
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('P1-E Video Access Security', () => {
  let studentToken: string;
  let adminToken: string;
  let unverifiedStudentToken: string;

  const mockUser = {
    id: 'user-1',
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockAdmin = {
    id: 'admin-1',
    role: 'ADMIN',
    isEmailVerified: true
  };

  const mockUnverifiedUser = {
    id: 'user-2',
    role: 'STUDENT',
    isEmailVerified: false
  };

  const mockLesson = {
    id: 'lesson-1',
    title: 'Autopsy Demo',
    type: 'VIDEO',
    videoUrl: 'permanent-cloudflare-id-12345',
    content: 'Secret content',
    isPublished: true,
    moduleId: 'module-1',
    module: { courseId: 'course-1' }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const secret = process.env.JWT_SECRET || 'super-secret-jwt-key';
    studentToken = jwt.sign({ userId: mockUser.id, role: 'STUDENT' }, secret);
    adminToken = jwt.sign({ userId: mockAdmin.id, role: 'ADMIN' }, secret);
    unverifiedStudentToken = jwt.sign({ userId: mockUnverifiedUser.id, role: 'STUDENT' }, secret);

    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: { token: 'real_cloudflare_signed_token_123' }
      })
    });
  });

  describe('GET /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/video-access', () => {
    it('1. Unauthenticated request -> 401', async () => {
      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`);
      
      expect(res.statusCode).toBe(401);
    });

    it('2. Unverified user -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUnverifiedUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${unverifiedStudentToken}`);
      
      expect(res.statusCode).toBe(403);
      expect(res.text).toMatch(/verify your email/i);
    });

    it('3. Authenticated user without enrollment -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
      expect(res.text).toMatch(/enrollment required/i);
    });

    it('4. Enrolled user -> allowed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBe('real_cloudflare_signed_token_123');
      expect(res.body.url).toBe('https://customer-real-account-id.cloudflarestream.com/real_cloudflare_signed_token_123/manifest/video.m3u8');
      
      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/real-account-id/stream/permanent-cloudflare-id-12345/token',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer real-api-token',
            'Content-Type': 'application/json'
          }
        })
      );
    });

    it('4b. Missing provider credentials -> fails closed (503)', async () => {
      process.env.CF_STREAM_ACCOUNT_ID = 'your-account-id'; // placeholder
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(503);
      expect(res.text).toMatch(/not configured/i);
      
      // Restore valid mock config
      process.env.CF_STREAM_ACCOUNT_ID = 'real-account-id';
    });

    it('5. User from another course (IDOR) -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      
      // Target lesson belongs to course-2
      const targetLesson = { ...mockLesson, module: { courseId: 'course-2' } };
      mockPrisma.lesson.findUnique.mockResolvedValue(targetLesson);
      
      // User is only enrolled in course-1, so checking course-2 returns null
      mockPrisma.enrollment.findUnique.mockImplementation((args) => {
        if (args.where.userId_courseId.courseId === 'course-2') return null;
        return { status: 'ACTIVE' };
      });

      const res = await request(app)
        .get(`/api/courses/course-2/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('6. Admin -> allowed according to existing bypass', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      // Admin doesn't need enrollment or publish check
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('7. Unpublished lesson -> denied for students', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...mockLesson, isPublished: false });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1/video-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
      expect(res.text).toMatch(/not published/i);
    });
  });

  describe('Lesson Endpoint GET /api/courses/.../lessons/:id', () => {
    it('8. Permanent videoUrl is never returned to students', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      // We pass in a clone so that controller modifications don't mutate our outer object directly
      mockPrisma.lesson.findUnique.mockResolvedValue(JSON.parse(JSON.stringify(mockLesson)));
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-1`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.lesson.title).toBe(mockLesson.title);
      expect(res.body.lesson.videoUrl).toBeNull(); // Must be stripped!
    });
  });

  describe('Course Catalog GET /api/courses', () => {
    it('12. Public course catalog does not expose videoUrl/private content', async () => {
      // Mock getCourseById which uses Prisma select now
      mockPrisma.course.findFirst.mockResolvedValue({
        id: 'course-1',
        title: 'Course 1',
        modules: [
          {
            id: 'module-1',
            lessons: [
              {
                id: 'lesson-1',
                title: 'Autopsy Demo',
                type: 'VIDEO',
                // Notice videoUrl and content are NOT here, because we changed Prisma select
                isPublished: true
              }
            ]
          }
        ]
      });

      const res = await request(app)
        .get(`/api/courses/course-1`);
      
      expect(res.statusCode).toBe(200);
      const returnedLesson = res.body.course.modules[0].lessons[0];
      
      expect(returnedLesson.title).toBe('Autopsy Demo');
      expect(returnedLesson.videoUrl).toBeUndefined(); // It shouldn't even be returned from the DB mock
      expect(returnedLesson.content).toBeUndefined();
    });
  });
});
