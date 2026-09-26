import { Router } from 'express';
import { register, login, getMe, refresh, logout } from '../controllers/authController';
import { registerValidator, loginValidator } from '../validators/authValidators';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();

router.post('/register', registerValidator, validate, asyncHandler(register));
router.post('/login', loginValidator, validate, asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.get('/me', authenticate, asyncHandler(getMe));

export default router;
