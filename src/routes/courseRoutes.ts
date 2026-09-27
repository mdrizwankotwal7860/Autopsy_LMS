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
import { body } from 'express-validator';
import { validate } from '../middleware/validate';

import moduleRoutes from './moduleRoutes';
import certificateRoutes from './certificateRoutes';

const router = Router();

// Mount nested routes
router.use('/:courseId/modules', moduleRoutes);
router.use('/:courseId/certificates', certificateRoutes);

// Public routes or student routes (depending on exact requirements, here we assume any authenticated user can view published courses)
router.get('/', asyncHandler(getCourses));
router.get('/:id', asyncHandler(getCourseById));

// Admin only routes
router.use(authenticate, authorize('ADMIN'));

const courseValidator = [
  body('title').notEmpty().withMessage('Title is required'),
  body('description').notEmpty().withMessage('Description is required'),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('status').optional().isIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']).withMessage('Invalid status'),
];

router.post('/', courseValidator, validate, asyncHandler(createCourse));
router.put('/:id', courseValidator, validate, asyncHandler(updateCourse));
router.delete('/:id', asyncHandler(deleteCourse));

export default router;
