import { Router } from 'express';
import { 
  createModule, 
  updateModule, 
  deleteModule 
} from '../controllers/moduleController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';

import lessonRoutes from './lessonRoutes';

const router = Router({ mergeParams: true }); // to access courseId from parent route

// Mount lesson routes
router.use('/:moduleId/lessons', param('moduleId').isUUID().withMessage('Invalid moduleId'), validate, lessonRoutes);

router.use(authenticate, authorize('ADMIN'));

const moduleValidator = [
  body('title').notEmpty().withMessage('Title is required').isLength({ max: 255 }),
  body('order').isInt().withMessage('Order must be an integer'),
  body('description').optional().isString().isLength({ max: 10000 }),
];

router.post('/', moduleValidator, validate, asyncHandler(createModule));
router.put('/:moduleId', param('moduleId').isUUID().withMessage('Invalid moduleId'), moduleValidator, validate, asyncHandler(updateModule));
router.delete('/:moduleId', param('moduleId').isUUID().withMessage('Invalid moduleId'), validate, asyncHandler(deleteModule));

export default router;
