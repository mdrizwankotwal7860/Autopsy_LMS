import { Router } from 'express';
import { getEnrollments, getEnrollmentById } from '../controllers/enrollmentController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { param } from 'express-validator';
import { validate } from '../middleware/validate';

const router = Router();

router.use(authenticate);

// Student can see their own enrollments, admins can see all or specific user's.
router.get('/', asyncHandler(getEnrollments));
router.get('/:id', param('id').isUUID().withMessage('Invalid enrollment id'), validate, asyncHandler(getEnrollmentById));

export default router;
