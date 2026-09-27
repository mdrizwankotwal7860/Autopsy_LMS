import { Router } from 'express';
import { 
  getExam, 
  startAttempt, 
  submitExam 
} from '../controllers/examController';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';

// We merge params so we can access courseId, moduleId, lessonId
const router = Router({ mergeParams: true });

router.use(authenticate);

// Student/Admin routes
router.get('/', asyncHandler(getExam));
router.post('/attempt', asyncHandler(startAttempt));

const submitValidator = [
  body('attemptId').isUUID().withMessage('attemptId must be a valid UUID'),
  body('answers').isObject().withMessage('answers must be an object map of questionId to answer')
];

router.post('/submit', submitValidator, validate, asyncHandler(submitExam));

export default router;
