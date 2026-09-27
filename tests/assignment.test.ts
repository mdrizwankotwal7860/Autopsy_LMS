// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import jwt from 'jsonwebtoken';
import { getFileUrl, uploadFile } from '../src/integrations/storage/r2Service';

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
  },
  assignmentSubmission: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  }
}));

jest.mock('../src/integrations/storage/r2Service', () => ({
  getFileUrl: jest.fn().mockResolvedValue('https://mocked.com/file.pdf'),
  uploadFile: jest.fn().mockResolvedValue('assignments/assignment-1/user-1/file.pdf')
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

describe('P2 Assignment Functionality', () => {
  let studentToken: string;
  let adminToken: string;
  let unenrolledStudentToken: string;

  const mockUser = {
    id: 'user-1',
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockUnenrolledUser = {
    id: 'user-2',
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockAdmin = {
    id: 'admin-1',
    role: 'ADMIN',
    isEmailVerified: true
  };

  const mockAssignment = {
    id: 'assignment-1',
    lessonId: 'lesson-1',
    title: 'Essay',
    description: 'Write an essay',
    maxMarks: 100
  };

  const mockLesson = {
    id: 'lesson-1',
    title: 'Assignment Lesson',
    type: 'ASSIGNMENT',
    isPublished: true,
    moduleId: 'module-1',
    module: { courseId: 'course-1' },
    assignments: [mockAssignment]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const secret = process.env.JWT_SECRET || 'super-secret-jwt-key';
    studentToken = jwt.sign({ userId: mockUser.id, role: 'STUDENT' }, secret);
    unenrolledStudentToken = jwt.sign({ userId: mockUnenrolledUser.id, role: 'STUDENT' }, secret);
    adminToken = jwt.sign({ userId: mockAdmin.id, role: 'ADMIN' }, secret);

    mockPrisma.user.findUnique.mockImplementation((args) => {
      if (args.where.id === 'user-1') return Promise.resolve(mockUser);
      if (args.where.id === 'user-2') return Promise.resolve(mockUnenrolledUser);
      if (args.where.id === 'admin-1') return Promise.resolve(mockAdmin);
      return Promise.resolve(null);
    });

    mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

    mockPrisma.enrollment.findUnique.mockImplementation((args) => {
      if (args.where.userId_courseId.userId === 'user-1') return Promise.resolve({ status: 'ACTIVE' });
      return Promise.resolve(null);
    });
  });

  describe('GET /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/assignment', () => {
    it('1. Authorized student can retrieve their assignment', async () => {
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment')
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.assignment.id).toBe('assignment-1');
    });

    it('2. Unenrolled student cannot retrieve it', async () => {
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment')
        .set('Authorization', `Bearer ${unenrolledStudentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('3. Wrong course/module/lesson relationship is rejected', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        ...mockLesson,
        module: { courseId: 'wrong-course' }
      });

      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment')
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/assignment/submit', () => {
    it('4. Student can submit a valid text assignment', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);
      mockPrisma.assignmentSubmission.create.mockResolvedValue({
        id: 'sub-1',
        assignmentId: 'assignment-1',
        userId: 'user-1',
        textAnswer: 'my essay',
        fileUrl: null,
        status: 'PENDING'
      });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ textAnswer: 'my essay' });
      
      expect(res.statusCode).toBe(201);
      expect(res.body.submission.textAnswer).toBe('my essay');
    });

    it('5. Duplicate submission is rejected safely', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({ id: 'existing-sub' });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ textAnswer: 'my essay' });
      
      expect(res.statusCode).toBe(409);
      expect(res.body.error.message).toMatch(/already submitted/i);
    });

    it('6. Unauthorized user cannot submit another student\'s assignment', async () => {
      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submit')
        .set('Authorization', `Bearer ${unenrolledStudentToken}`)
        .send({ textAnswer: 'hacked' });
      
      expect(res.statusCode).toBe(403);
    });

    it('7. File validation/security - blocks invalid type', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('file', Buffer.from('console.log("hack")'), { filename: 'hack.js', contentType: 'application/javascript' });
      
      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid file type/);
    });
  });

  describe('POST /api/courses/:courseId/.../submissions/:submissionId/grade', () => {
    it('8. Admin grading authorization', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({
        id: 'sub-1',
        assignmentId: 'assignment-1',
        userId: 'user-1'
      });

      mockPrisma.assignmentSubmission.update.mockResolvedValue({
        id: 'sub-1',
        marks: 90,
        status: 'GRADED'
      });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submissions/sub-1/grade')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ marks: 90, feedback: 'Good' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body.submission.marks).toBe(90);
    });

    it('9. Student cannot grade', async () => {
      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-1/assignment/submissions/sub-1/grade')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ marks: 90, feedback: 'Good' });
      
      expect(res.statusCode).toBe(403);
    });
  });
});
