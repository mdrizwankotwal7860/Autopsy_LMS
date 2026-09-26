import { Router } from 'express';
import { register, login, getMe, refresh, logout, verifyEmail, resendVerification, forgotPassword, resetPassword } from '../controllers/authController';
import { registerValidator, loginValidator } from '../validators/authValidators';
import { validate } from '../middleware/validate';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { authLimiter, verifyEmailLimiter, resendVerificationLimiter, forgotPasswordLimiter, resetPasswordLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', authLimiter, registerValidator, validate, asyncHandler(register));
router.post('/login', authLimiter, loginValidator, validate, asyncHandler(login));
router.post('/refresh', authLimiter, asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));
router.get('/me', authenticate, asyncHandler(getMe));

// P1-D Email & Password Security Routes
router.post('/verify-email', verifyEmailLimiter, asyncHandler(verifyEmail));
router.post('/resend-verification', resendVerificationLimiter, asyncHandler(resendVerification));
router.post('/forgot-password', forgotPasswordLimiter, asyncHandler(forgotPassword));
router.post('/reset-password', resetPasswordLimiter, asyncHandler(resetPassword));

export default router;
