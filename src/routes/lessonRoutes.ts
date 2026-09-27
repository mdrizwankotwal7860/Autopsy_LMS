import { Router } from 'express';
import { 
  createLesson, 
  updateLesson, 
  deleteLesson,
  getLesson,
  getVideoAccess,
  getDocumentAccess
} from '../controllers/lessonController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import assignmentRoutes from './assignmentRoutes';

const router = Router({ mergeParams: true });

router.use('/:lessonId/assignment', assignmentRoutes);

router.use(authenticate);

// Public/Student routes (requires enrollment logic in controller)
router.get('/:lessonId', asyncHandler(getLesson));
router.get('/:lessonId/video-access', asyncHandler(getVideoAccess));
router.get('/:lessonId/document-access', asyncHandler(getDocumentAccess));

// Admin only routes
router.use(authorize('ADMIN'));

const lessonValidator = [
  body('title').notEmpty().withMessage('Title is required'),
  body('type').isIn(['VIDEO', 'TEXT', 'DOCUMENT', 'ASSIGNMENT', 'EXAM']).withMessage('Invalid lesson type'),
  body('order').isInt().withMessage('Order must be an integer'),
  body('isPublished').optional().isBoolean(),
];

router.post('/', lessonValidator, validate, asyncHandler(createLesson));
router.put('/:lessonId', lessonValidator, validate, asyncHandler(updateLesson));
router.delete('/:lessonId', asyncHandler(deleteLesson));

export default router;
