import { Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, ForbiddenError, BadRequestError } from '../utils/errors';
import { AuthRequest } from '../middleware/authMiddleware';

const verifyRelationship = async (
  userId: string,
  userRole: string,
  courseId: string,
  moduleId: string,
  lessonId: string
) => {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: true,
      exams: {
        include: {
          questions: {
            select: {
              id: true,
              text: true,
              options: true,
              marks: true,
              order: true
              // DO NOT select 'answer'
            }
          }
        }
      }
    }
  });

  if (!lesson || lesson.moduleId !== moduleId || lesson.module.courseId !== courseId) {
    throw new NotFoundError('Exam not found');
  }

  if (lesson.type !== 'EXAM') {
    throw new BadRequestError('This lesson is not an exam');
  }

  if (userRole !== 'ADMIN') {
    if (!lesson.isPublished) {
      throw new ForbiddenError('Exam is not published');
    }

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_courseId: { userId, courseId } }
    });

    if (!enrollment || enrollment.status !== 'ACTIVE') {
      throw new ForbiddenError('Active enrollment required to access this exam');
    }
  }

  const exam = lesson.exams?.[0];
  if (!exam) {
    throw new NotFoundError('Exam details not found');
  }

  return exam;
};

export const getExam = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  // @ts-ignore
  const isEmailVerified = req.user!.isEmailVerified;

  if (userRole !== 'ADMIN' && !isEmailVerified) {
    throw new ForbiddenError('You must verify your email before accessing exams');
  }

  const exam = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  // Randomize questions server-side
  // We use Fisher-Yates shuffle algorithm on the questions array
  const questions = [...exam.questions];
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  const randomizedExam = {
    ...exam,
    questions
  };

  res.status(200).json({ exam: randomizedExam });
};

export const startAttempt = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  // @ts-ignore
  const isEmailVerified = req.user!.isEmailVerified;

  if (userRole !== 'ADMIN' && !isEmailVerified) {
    throw new ForbiddenError('You must verify your email before starting exams');
  }

  const exam = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  const attempt = await prisma.examAttempt.create({
    data: {
      examId: exam.id,
      userId
    }
  });

  res.status(201).json({ message: 'Exam attempt started', attempt });
};

export const submitExam = async (req: AuthRequest, res: Response) => {
  const { courseId, moduleId, lessonId } = req.params;
  // @ts-ignore
  const userId = req.user!.id;
  // @ts-ignore
  const userRole = req.user!.role;
  // @ts-ignore
  const isEmailVerified = req.user!.isEmailVerified;

  if (userRole !== 'ADMIN' && !isEmailVerified) {
    throw new ForbiddenError('You must verify your email before submitting exams');
  }

  // The answers format is expected to be { [questionId: string]: string }
  const { attemptId, answers } = req.body;

  if (!attemptId || !answers) {
    throw new BadRequestError('attemptId and answers are required');
  }

  const exam = await verifyRelationship(userId, userRole, courseId, moduleId, lessonId);

  // Use a transaction to ensure consistent submission update
  const result = await prisma.$transaction(async (tx) => {
    const attempt = await tx.examAttempt.findUnique({
      where: { id: attemptId }
    });

    if (!attempt || attempt.userId !== userId || attempt.examId !== exam.id) {
      throw new NotFoundError('Exam attempt not found or does not belong to user');
    }

    if (attempt.endedAt) {
      throw new BadRequestError('This exam attempt has already been submitted');
    }

    // Timer enforcement
    if (exam.timeLimitMins) {
      const timeLimitMs = exam.timeLimitMins * 60 * 1000;
      const elapsedMs = Date.now() - attempt.startedAt.getTime();

      // Allow a small 30 seconds grace period for network latency
      if (elapsedMs > timeLimitMs + 30000) {
        throw new BadRequestError('Time limit exceeded');
      }
    }

    // Fetch the full questions with answers for evaluation
    const questions = await tx.question.findMany({
      where: { examId: exam.id }
    });

    let score = 0;
    let totalMarks = 0;

    questions.forEach((q) => {
      totalMarks += q.marks;
      const studentAnswer = answers[q.id];
      if (studentAnswer && studentAnswer === q.answer) {
        score += q.marks;
      }
    });

    const passed = score >= exam.passingMarks;

    const updatedAttempt = await tx.examAttempt.update({
      where: { id: attemptId },
      data: {
        score,
        passed,
        endedAt: new Date()
      }
    });

    return {
      attemptId: updatedAttempt.id,
      score,
      totalMarks,
      passed,
      startedAt: updatedAttempt.startedAt,
      endedAt: updatedAttempt.endedAt
    };
  });

  res.status(200).json({ message: 'Exam submitted successfully', result });
};
