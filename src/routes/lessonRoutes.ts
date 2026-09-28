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
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';
import assignmentRoutes from './assignmentRoutes';
import examRoutes from './examRoutes';

const router = Router({ mergeParams: true });

router.use('/:lessonId/assignment', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, assignmentRoutes);
router.use('/:lessonId/exam', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, examRoutes);

router.use(authenticate);

// Public/Student routes (requires enrollment logic in controller)
router.get('/:lessonId', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, asyncHandler(getLesson));
router.get('/:lessonId/video-access', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, asyncHandler(getVideoAccess));
router.get('/:lessonId/document-access', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, asyncHandler(getDocumentAccess));

// Admin only routes
router.use(authorize('ADMIN'));

const lessonValidator = [
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 255 }),
  body('type').isIn(['VIDEO', 'TEXT', 'DOCUMENT', 'ASSIGNMENT', 'EXAM']).withMessage('Invalid lesson type'),
  body('order').isInt().withMessage('Order must be an integer'),
  body('isPublished').optional().isBoolean(),
];

router.post('/', lessonValidator, validate, asyncHandler(createLesson));
router.put('/:lessonId', param('lessonId').isUUID().withMessage('Invalid lessonId'), lessonValidator, validate, asyncHandler(updateLesson));
router.delete('/:lessonId', param('lessonId').isUUID().withMessage('Invalid lessonId'), validate, asyncHandler(deleteLesson));

export default router;
