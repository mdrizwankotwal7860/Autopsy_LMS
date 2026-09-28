import { Router } from 'express';
import { register, login, getMe, refresh, logout, verifyEmail, resendVerification, forgotPassword, resetPassword } from '../controllers/authController';
import { 
  registerValidator, 
  loginValidator, 
  verifyEmailValidator, 
  resendVerificationValidator, 
  forgotPasswordValidator, 
  resetPasswordValidator 
} from '../validators/authValidators';
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
router.post('/verify-email', verifyEmailLimiter, verifyEmailValidator, validate, asyncHandler(verifyEmail));
router.post('/resend-verification', resendVerificationLimiter, resendVerificationValidator, validate, asyncHandler(resendVerification));
router.post('/forgot-password', forgotPasswordLimiter, forgotPasswordValidator, validate, asyncHandler(forgotPassword));
router.post('/reset-password', resetPasswordLimiter, resetPasswordValidator, validate, asyncHandler(resetPassword));

export default router;
