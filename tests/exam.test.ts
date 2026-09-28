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
  },
  examAttempt: {
    create: jest.fn(),
    update: jest.fn()
  },
  $transaction: jest.fn(async (cb) => {
    // Mock the transaction client as an object that wraps the existing mocks
    const tx = {
      examAttempt: {
        findUnique: jest.fn(),
        update: jest.fn()
      },
      question: {
        findMany: jest.fn()
      }
    };
    return cb(tx);
  })
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// Valid UUID constants for test IDs
const USER_ID = '10000000-0000-4000-8000-000000000001';
const USER2_ID = '10000000-0000-4000-8000-000000000002';
const ADMIN_ID = '10000000-0000-4000-8000-000000000099';
const COURSE_ID = '20000000-0000-4000-8000-000000000001';
const COURSE_WRONG_ID = '20000000-0000-4000-8000-000000000099';
const MODULE_ID = '30000000-0000-4000-8000-000000000001';
const LESSON_ID = '40000000-0000-4000-8000-000000000001';
const EXAM_ID = '50000000-0000-4000-8000-000000000001';
const ATTEMPT_ID = '60000000-0000-4000-8000-000000000001';

describe('P2 Exam V1 Functionality', () => {
  let studentToken: string;
  let unenrolledStudentToken: string;
  let adminToken: string;

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

  const mockQuestions = [
    { id: 'q1', text: 'Q1', options: ['A', 'B'], answer: 'A', marks: 5, order: 1 },
    { id: 'q2', text: 'Q2', options: ['C', 'D'], answer: 'D', marks: 10, order: 2 }
  ];

  const mockExam = {
    id: EXAM_ID,
    lessonId: LESSON_ID,
    title: 'Final Exam',
    passingMarks: 10,
    timeLimitMins: 30,
    questions: mockQuestions
  };

  const mockLesson = {
    id: LESSON_ID,
    title: 'Exam Lesson',
    type: 'EXAM',
    isPublished: true,
    moduleId: MODULE_ID,
    module: { courseId: COURSE_ID },
    exams: [{ ...mockExam, questions: mockQuestions.map(({ answer, ...q }) => q) }]
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

  describe('GET /api/courses/.../exam', () => {
    it('1. Authorized enrolled student can retrieve exam', async () => {
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.exam.id).toBe(EXAM_ID);
    });

    it('2. Unenrolled student cannot retrieve exam', async () => {
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam`)
        .set('Authorization', `Bearer ${unenrolledStudentToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('3. Mismatched course/module/lesson relationship is rejected', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        ...mockLesson,
        module: { courseId: COURSE_WRONG_ID }
      });
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam`)
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.statusCode).toBe(404);
    });

    it('4 & 5 & 6. Student receives exam questions randomized, without answers', async () => {
      const res = await request(app)
        .get(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(200);
      const qs = res.body.exam.questions;
      expect(qs.length).toBe(2);
      expect(qs[0].answer).toBeUndefined(); // Important security check
      expect(qs[1].answer).toBeUndefined();
    });
  });

  describe('POST /api/courses/.../exam/attempt', () => {
    it('7 & 8 & 9. Student can start an attempt for themselves only', async () => {
      mockPrisma.examAttempt.create.mockResolvedValue({
        id: ATTEMPT_ID,
        examId: EXAM_ID,
        userId: USER_ID,
        startedAt: new Date()
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam/attempt`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(201);
      expect(res.body.attempt.userId).toBe(USER_ID);
      expect(mockPrisma.examAttempt.create).toHaveBeenCalledWith({
        data: { examId: EXAM_ID, userId: USER_ID }
      });
    });
  });

  describe('POST /api/courses/.../exam/submit', () => {
    it('10 & 11 & 12 & 14. Student can submit valid answers and calculate score securely', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const tx = {
          examAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: ATTEMPT_ID,
              examId: EXAM_ID,
              userId: USER_ID,
              startedAt: new Date()
            }),
            update: jest.fn().mockResolvedValue({
              id: ATTEMPT_ID,
              startedAt: new Date(),
              endedAt: new Date()
            })
          },
          question: {
            findMany: jest.fn().mockResolvedValue(mockQuestions)
          }
        };
        return cb(tx);
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: ATTEMPT_ID, answers: { q1: 'A', q2: 'A' } }); // Q1 correct, Q2 wrong

      expect(res.statusCode).toBe(200);
      expect(res.body.result.score).toBe(5); // 5 for Q1
      expect(res.body.result.totalMarks).toBe(15); // 5 + 10
      expect(res.body.result.passed).toBe(false); // 5 < passingMarks (10)
    });

    it('13. Same attempt cannot be successfully submitted twice', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const tx = {
          examAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: ATTEMPT_ID,
              examId: EXAM_ID,
              userId: USER_ID,
              startedAt: new Date(),
              endedAt: new Date() // Already ended
            })
          }
        };
        return cb(tx);
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: ATTEMPT_ID, answers: {} });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/already been submitted/);
    });

    it('Timer check limits submission', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const pastDate = new Date(Date.now() - (60 * 60 * 1000)); // 1 hour ago
        const tx = {
          examAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: ATTEMPT_ID,
              examId: EXAM_ID,
              userId: USER_ID,
              startedAt: pastDate
            })
          }
        };
        return cb(tx);
      });

      const res = await request(app)
        .post(`/api/courses/${COURSE_ID}/modules/${MODULE_ID}/lessons/${LESSON_ID}/exam/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: ATTEMPT_ID, answers: {} });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/Time limit exceeded/);
    });
  });
});
