import { Router } from 'express';
import { getUsers, getUserById, updateEligibility } from '../controllers/userController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';

const router = Router();

// Protect all user routes
router.use(authenticate);

// Admin only routes
router.use(authorize('ADMIN'));

router.get('/', asyncHandler(getUsers));
router.get('/:id', param('id').isUUID().withMessage('Invalid user id'), validate, asyncHandler(getUserById));

router.put(
  '/:id/eligibility',
  [
    param('id').isUUID().withMessage('Invalid user id'),
    body('status').isIn(['PENDING', 'APPROVED', 'REJECTED']).withMessage('Invalid status'),
  ],
  validate,
  asyncHandler(updateEligibility)
);

export default router;
