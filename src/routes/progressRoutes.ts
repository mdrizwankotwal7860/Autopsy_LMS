import { Router } from 'express';
import { updateProgress, getCourseProgress } from '../controllers/progressController';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);

router.post(
  '/',
  [
    body('lessonId').isUUID().withMessage('lessonId must be a valid UUID'),
    body('isCompleted').optional().isBoolean(),
    body('lastWatched').optional().isInt()
  ],
  validate,
  asyncHandler(updateProgress)
);

router.get('/course/:courseId', param('courseId').isUUID().withMessage('Invalid courseId'), validate, asyncHandler(getCourseProgress));

export default router;
