import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import redisClient, { redisEnabled } from '../utils/redis';
import { Request } from 'express';

// Helper to safely parse limits
const getLimit = (envVar: string, defaultLimit: number): number => {
  const val = parseInt(process.env[envVar] || '', 10);
  if (isNaN(val) || val <= 0) return defaultLimit;
  return val;
};

// Error payload format to match the app's existing AppError structure
const rateLimitErrorHandler = (req: any, res: any) => {
  res.status(429).json({
    status: 'error',
    message: 'Too many requests, please try again later.'
  });
};

const keyGenerator = (req: Request): string => {
  const ip = (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown';
  return ip.replace(/^::ffff:/, '');
};

const validateOptions = { validations: { ip: false } };

const createRedisStore = (prefix: string) => {
  return redisEnabled && redisClient ? new RedisStore({
    prefix,
    sendCommand: (...args: string[]) => {
      if (!redisClient) return Promise.reject(new Error('Redis not initialized'));
      return redisClient.call(args[0], ...args.slice(1)) as any;
    }
  }) : undefined;
};

// 1. Strict Authentication Limiter
// Protects login, register, refresh against brute-force and credential stuffing
export const authLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit('AUTH_RATE_LIMIT_MAX', 10), // Limit each IP to 10 requests per window
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:auth:'),
});

// 2. General API Limiter
// Prevents general API abuse/DDoS while allowing normal LMS operations
export const apiLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit('API_RATE_LIMIT_MAX', 200), // Generous limit for normal usage
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:api:'),
});

// 3. Forgot Password Limiter
export const forgotPasswordLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000,
  max: getLimit('FORGOT_PASSWORD_RATE_LIMIT_MAX', 3),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:forgotpw:')
});

// 4. Reset Password Limiter
export const resetPasswordLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000,
  max: getLimit('RESET_PASSWORD_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:resetpw:')
});

// 5. Verify Email Limiter
export const verifyEmailLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000,
  max: getLimit('VERIFY_EMAIL_RATE_LIMIT_MAX', 5),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:verifyem:')
});

// 6. Resend Verification Limiter
export const resendVerificationLimiter = rateLimit({
  validate: false,
  windowMs: 15 * 60 * 1000,
  max: getLimit('RESEND_VERIFICATION_RATE_LIMIT_MAX', 3),
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:resendem:')
});
