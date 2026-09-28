import { Router } from 'express';
import { 
  createCourse, 
  getCourses, 
  getCourseById, 
  updateCourse, 
  deleteCourse 
} from '../controllers/courseController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';

import moduleRoutes from './moduleRoutes';
import certificateRoutes from './certificateRoutes';

const router = Router();

// Mount nested routes
router.use('/:courseId/modules', param('courseId').isUUID().withMessage('Invalid courseId'), validate, moduleRoutes);
router.use('/:courseId/certificates', param('courseId').isUUID().withMessage('Invalid courseId'), validate, certificateRoutes);

// Public routes or student routes (depending on exact requirements, here we assume any authenticated user can view published courses)
router.get('/', asyncHandler(getCourses));
router.get('/:id', param('id').isUUID().withMessage('Invalid course id'), validate, asyncHandler(getCourseById));

// Admin only routes
router.use(authenticate, authorize('ADMIN'));

const courseValidator = [
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 255 }),
  body('description').notEmpty().withMessage('Description is required').isLength({ max: 10000 }),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('status').optional().isIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']).withMessage('Invalid status'),
];

router.post('/', courseValidator, validate, asyncHandler(createCourse));
router.put('/:id', param('id').isUUID().withMessage('Invalid course id'), courseValidator, validate, asyncHandler(updateCourse));
router.delete('/:id', param('id').isUUID().withMessage('Invalid course id'), validate, asyncHandler(deleteCourse));

export default router;
