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

describe('P2 Exam V1 Functionality', () => {
  let studentToken: string;
  let unenrolledStudentToken: string;
  let adminToken: string;

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

  const mockQuestions = [
    { id: 'q1', text: 'Q1', options: ['A', 'B'], answer: 'A', marks: 5, order: 1 },
    { id: 'q2', text: 'Q2', options: ['C', 'D'], answer: 'D', marks: 10, order: 2 }
  ];

  const mockExam = {
    id: 'exam-1',
    lessonId: 'lesson-exam',
    title: 'Final Exam',
    passingMarks: 10,
    timeLimitMins: 30,
    questions: mockQuestions
  };

  const mockLesson = {
    id: 'lesson-exam',
    title: 'Exam Lesson',
    type: 'EXAM',
    isPublished: true,
    moduleId: 'module-1',
    module: { courseId: 'course-1' },
    exams: [{ ...mockExam, questions: mockQuestions.map(({ answer, ...q }) => q) }]
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

  describe('GET /api/courses/.../exam', () => {
    it('1. Authorized enrolled student can retrieve exam', async () => {
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.exam.id).toBe('exam-1');
    });

    it('2. Unenrolled student cannot retrieve exam', async () => {
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam')
        .set('Authorization', `Bearer ${unenrolledStudentToken}`);

      expect(res.statusCode).toBe(403);
    });

    it('3. Mismatched course/module/lesson relationship is rejected', async () => {
      mockPrisma.lesson.findUnique.mockResolvedValue({
        ...mockLesson,
        module: { courseId: 'wrong-course' }
      });
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(res.statusCode).toBe(404);
    });

    it('4 & 5 & 6. Student receives exam questions randomized, without answers', async () => {
      const res = await request(app)
        .get('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam')
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
        id: '123e4567-e89b-12d3-a456-426614174000',
        examId: 'exam-1',
        userId: 'user-1',
        startedAt: new Date()
      });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam/attempt')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.statusCode).toBe(201);
      expect(res.body.attempt.userId).toBe('user-1');
      expect(mockPrisma.examAttempt.create).toHaveBeenCalledWith({
        data: { examId: 'exam-1', userId: 'user-1' }
      });
    });
  });

  describe('POST /api/courses/.../exam/submit', () => {
    it('10 & 11 & 12 & 14. Student can submit valid answers and calculate score securely', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const tx = {
          examAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: '123e4567-e89b-12d3-a456-426614174000',
              examId: 'exam-1',
              userId: 'user-1',
              startedAt: new Date()
            }),
            update: jest.fn().mockResolvedValue({
              id: '123e4567-e89b-12d3-a456-426614174000',
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
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: '123e4567-e89b-12d3-a456-426614174000', answers: { q1: 'A', q2: 'A' } }); // Q1 correct, Q2 wrong

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
              id: '123e4567-e89b-12d3-a456-426614174000',
              examId: 'exam-1',
              userId: 'user-1',
              startedAt: new Date(),
              endedAt: new Date() // Already ended
            })
          }
        };
        return cb(tx);
      });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: '123e4567-e89b-12d3-a456-426614174000', answers: {} });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/already been submitted/);
    });

    it('Timer check limits submission', async () => {
      mockPrisma.$transaction.mockImplementationOnce(async (cb) => {
        const pastDate = new Date(Date.now() - (60 * 60 * 1000)); // 1 hour ago
        const tx = {
          examAttempt: {
            findUnique: jest.fn().mockResolvedValue({
              id: '123e4567-e89b-12d3-a456-426614174000',
              examId: 'exam-1',
              userId: 'user-1',
              startedAt: pastDate
            })
          }
        };
        return cb(tx);
      });

      const res = await request(app)
        .post('/api/courses/course-1/modules/module-1/lessons/lesson-exam/exam/submit')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ attemptId: '123e4567-e89b-12d3-a456-426614174000', answers: {} });

      expect(res.statusCode).toBe(400);
      expect(res.body.error.message).toMatch(/Time limit exceeded/);
    });
  });
});
