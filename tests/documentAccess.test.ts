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

// Valid UUID constants for test IDs
const USER_ID = '10000000-0000-4000-8000-000000000001';
const ADMIN_ID = '10000000-0000-4000-8000-000000000099';
const USER2_ID = '10000000-0000-4000-8000-000000000002';
const COURSE_ID = '20000000-0000-4000-8000-000000000001';
const COURSE2_ID = '20000000-0000-4000-8000-000000000002';
const MODULE_ID = '30000000-0000-4000-8000-000000000001';
const LESSON_ID = '40000000-0000-4000-8000-000000000001';

describe('P2 File/Document Access Security', () => {
  let studentToken: string;
  let adminToken: string;
  let unverifiedStudentToken: string;

  const mockUser = {
    id: USER_ID,
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockAdmin = {
    id: ADMIN_ID,
    role: 'ADMIN',
    isEmailVerified: true
  };

  const mockUnverifiedUser = {
    id: USER2_ID,
    role: 'STUDENT',
    isEmailVerified: false
  };

  const mockLesson = {
    id: LESSON_ID,
    title: 'Autopsy Manual',
    type: 'DOCUMENT',
    content: `materials/${COURSE_ID}/doc-123.pdf`,
    videoUrl: null,
    isPublished: true,
    moduleId: MODULE_ID,
    module: { courseId: COURSE_ID }
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
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`);
      
      expect(res.statusCode).toBe(401);
    });

    it('2. Unverified student -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUnverifiedUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${unverifiedStudentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('3. Authenticated user without enrollment -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('4. Enrolled student -> allowed', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue({ status: 'ACTIVE' });

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://mocked-presigned-url.com/doc.pdf?temp=123');
      expect(getFileUrl).toHaveBeenCalledWith(mockLesson.content);
    });

    it('5. User from another course (IDOR) -> 403', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      
      const targetLesson = { ...mockLesson, module: { courseId: COURSE2_ID } };
      mockPrisma.lesson.findUnique.mockResolvedValue(targetLesson);
      
      mockPrisma.enrollment.findUnique.mockImplementation((args) => {
        if (args.where.userId_courseId.courseId === COURSE2_ID) return null;
        return { status: 'ACTIVE' };
      });

      const res = await request(app)
        .get(`/api/courses/${COURSE2_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('6. Admin -> allowed according to existing bypass', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockAdmin);
      mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);
      mockPrisma.enrollment.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${adminToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBeDefined();
    });

    it('7. Unpublished lesson -> denied for students', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...mockLesson, isPublished: false });

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('8. Wrong lesson type -> 400', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockPrisma.lesson.findUnique.mockResolvedValue({ ...mockLesson, type: 'VIDEO' });

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/document-access`)
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
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}`)
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
        .get(`/api/files/protected-file?key=materials/${COURSE_ID}/doc-123.pdf`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(403);
    });
  });
});
