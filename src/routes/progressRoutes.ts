import { Router } from 'express';
import { updateProgress, getCourseProgress } from '../controllers/progressController';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  [
    body('lessonId').notEmpty().withMessage('lessonId is required'),
    body('isCompleted').optional().isBoolean(),
    body('lastWatched').optional().isInt()
  ],
  validate,
  asyncHandler(updateProgress)
);

router.get('/course/:courseId', asyncHandler(getCourseProgress));

export default router;
