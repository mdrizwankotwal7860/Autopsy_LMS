// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
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

jest.mock('../src/integrations/storage/r2Service', () => ({
  getFileUrl: jest.fn().mockResolvedValue('https://mocked-presigned-url.com/doc.pdf?temp=123')
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;
import { getFileUrl } from '../src/integrations/storage/r2Service';

describe('P2 File/Document Access Security', () => {
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
    id: 'lesson-doc-1',
    title: 'Autopsy Manual',
    type: 'DOCUMENT',
    content: 'materials/course-1/doc-123.pdf',
    videoUrl: null,
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
  });

  describe('GET /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/document-access', () => {
    it('1. Unauthenticated request -> 401', async () => {
      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`);
      
      expect(res.statusCode).toBe(401);
    });

    it('2. Unverified student -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUnverifiedUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${unverifiedStudentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('3. Authenticated user without enrollment -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('4. Enrolled student -> allowed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://mocked-presigned-url.com/doc.pdf?temp=123');
      expect(getFileUrl).toHaveBeenCalledWith(mockLesson.content);
    });

    it('5. User from another course (IDOR) -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      
      const targetLesson = { ...mockLesson, module: { courseId: 'course-2' } };
      mockPrisma.lesson.findUnique.mockResolvedValue(targetLesson);
      
      mockPrisma.enrollment.findUnique.mockImplementation((args) => {
        if (args.where.userId_courseId.courseId === 'course-2') return null;
        return { status: 'ACTIVE' };
      });

      const res = await request(app)
        .get(`/api/courses/course-2/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('6. Admin -> allowed according to existing bypass', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBeDefined();
    });

    it('7. Unpublished lesson -> denied for students', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...mockLesson, isPublished: false });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('8. Wrong lesson type -> 400', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...mockLesson, type: 'VIDEO' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(400);
    });
  });

  describe('Lesson Endpoint GET /api/courses/.../lessons/:id', () => {
    it('9. Permanent document key is scrubbed from students', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(JSON.parse(JSON.stringify(mockLesson)));
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/course-1/modules/module-1/lessons/lesson-doc-1`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.lesson.title).toBe(mockLesson.title);
      expect(res.body.lesson.content).toBe('AVAILABLE_VIA_ENDPOINT');
    });
  });

  describe('Legacy Protected File Endpoint GET /api/files/protected-file', () => {
    it('10. Allows CV access for the matching user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await request(app)
        .get(`/api/files/protected-file?key=cvs/${mockUser.id}/resume.pdf`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://mocked-presigned-url.com/doc.pdf?temp=123');
    });

    it('11. Blocks IDOR CV access for another user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await request(app)
        .get(`/api/files/protected-file?key=cvs/another-user-id/resume.pdf`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('12. Blocks arbitrary course document access via legacy endpoint', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const res = await request(app)
        .get(`/api/files/protected-file?key=materials/course-1/doc-123.pdf`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });
  });
});
