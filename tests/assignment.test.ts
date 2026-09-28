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
  uploadFile: jest.fn().mockResolvedValue('assignments/a0000000-0000-4000-8000-000000000001/u0000000-0000-4000-8000-000000000001/file.pdf')
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// Valid UUID constants for test IDs
const USER_ID = '10000000-0000-4000-8000-000000000001';
const USER2_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000099';
const COURSE_ID = '20000000-0000-4000-8000-000000000001';
const MODULE_ID = '30000000-0000-4000-8000-000000000001';
const LESSON_ID = '40000000-0000-4000-8000-000000000001';
const ASSIGNMENT_ID = '50000000-0000-4000-8000-000000000001';
const SUBMISSION_ID = '60000000-0000-4000-8000-000000000001';

describe('P2 Assignment Functionality', () => {
  let studentToken: string;
  let adminToken: string;
  let unenrolledStudentToken: string;

  const mockUser = {
    id: USER_ID,
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockUnenrolledUser = {
    id: USER2_ID,
    role: 'STUDENT',
    isEmailVerified: true
  };

  const mockAdmin = {
    id: ADMIN_ID,
    role: 'ADMIN',
    isEmailVerified: true
  };

  const mockAssignment = {
    id: ASSIGNMENT_ID,
    lessonId: LESSON_ID,
    title: 'Essay',
    description: 'Write an essay',
    maxMarks: 100
  };

  const mockLesson = {
    id: LESSON_ID,
    title: 'Assignment Lesson',
    type: 'ASSIGNMENT',
    isPublished: true,
    moduleId: MODULE_ID,
    module: { courseId: COURSE_ID },
    assignments: [mockAssignment]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    const secret = process.env.JWT_SECRET || 'super-secret-jwt-key';
    studentToken = jwt.sign({ userId: mockUser.id, role: 'STUDENT' }, secret);
    unenrolledStudentToken = jwt.sign({ userId: mockUnenrolledUser.id, role: 'STUDENT' }, secret);
    adminToken = jwt.sign({ userId: mockAdmin.id, role: 'ADMIN' }, secret);

    mockPrisma.user.findUnique.mockImplementation((args) => {
      if (args.where.id === USER_ID) return Promise.resolve(mockUser);
      if (args.where.id === USER2_ID) return Promise.resolve(mockUnenrolledUser);
      if (args.where.id === ADMIN_ID) return Promise.resolve(mockAdmin);
      return Promise.resolve(null);
    });

    mockPrisma.lesson.findUnique.mockResolvedValue(mockLesson);

    mockPrisma.enrollment.findUnique.mockImplementation((args) => {
      if (args.where.userId_courseId.userId === USER_ID) return Promise.resolve({ status: 'ACTIVE' });
      return Promise.resolve(null);
    });
  });

  describe('GET /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/assignment', () => {
    it('1. Authorized student can retrieve their assignment', async () => {
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(200);
      expect(res.body.assignment.id).toBe(ASSIGNMENT_ID);
    });

    it('2. Unenrolled student cannot retrieve it', async () => {
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment`)
        .set('Authorization', `Bearer ${unenrolledStudentToken}`);
      
      expect(res.statusCode).toBe(403);
    });

    it('3. Wrong course/module/lesson relationship is rejected', async () => {
      const WRONG_COURSE_ID = '20000000-0000-4000-8000-000000000099';
      mockPrisma.lesson.findUnique.mockResolvedValue({
        ...mockLesson,
        module: { courseId: WRONG_COURSE_ID }
      });

      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment`)
        .set('Authorization', `Bearer ${studentToken}`);
      
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/courses/:courseId/modules/:moduleId/lessons/:lessonId/assignment/submit', () => {
    it('4. Student can submit a valid text assignment', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);
      mockPrisma.assignmentSubmission.create.mockResolvedValue({
        id: SUBMISSION_ID,
        assignmentId: ASSIGNMENT_ID,
        userId: USER_ID,
        textAnswer: 'my essay',
        fileUrl: null,
        status: 'PENDING'
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ textAnswer: 'my essay' });
      
      expect(res.statusCode).toBe(201);
      expect(res.body.submission.textAnswer).toBe('my essay');
    });

    it('5. Duplicate submission is rejected safely', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({ id: 'existing-sub' });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ textAnswer: 'my essay' });
      
      expect(res.statusCode).toBe(409);
      expect(res.body.error.message).toMatch(/already submitted/i);
    });

    it('6. Unauthorized user cannot submit another student\'s assignment', async () => {
      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submit`)
        .set('Authorization', `Bearer ${unenrolledStudentToken}`)
        .send({ textAnswer: 'hacked' });
      
      expect(res.statusCode).toBe(403);
    });

    it('7. File validation/security - blocks invalid type', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .attach('file', Buffer.from('console.log("hack")'), { filename: 'hack.js', contentType: 'application/javascript' });
      
      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid file type/);
    });
  });

  describe('POST /api/courses/:courseId/.../submissions/:submissionId/grade', () => {
    it('8. Admin grading authorization', async () => {
      mockPrisma.assignmentSubmission.findUnique.mockResolvedValue({
        id: SUBMISSION_ID,
        assignmentId: ASSIGNMENT_ID,
        userId: USER_ID
      });

      mockPrisma.assignmentSubmission.update.mockResolvedValue({
        id: SUBMISSION_ID,
        marks: 90,
        status: 'GRADED'
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submissions/${SUBMISSION_ID}/grade`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ marks: 90, feedback: 'Good' });
      
      expect(res.statusCode).toBe(200);
      expect(res.body.submission.marks).toBe(90);
    });

    it('9. Student cannot grade', async () => {
      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/assignment/submissions/${SUBMISSION_ID}/grade`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ marks: 90, feedback: 'Good' });
      
      expect(res.statusCode).toBe(403);
    });
  });
});
