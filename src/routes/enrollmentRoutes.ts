import { Router } from 'express';
import { getEnrollments, getEnrollmentById } from '../controllers/enrollmentController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.use(authenticate);

// Student can see their own enrollments, admins can see all or specific user's.
router.get('/', asyncHandler(getEnrollments));
router.get('/:id', asyncHandler(getEnrollmentById));

export default router;
