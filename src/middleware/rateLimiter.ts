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

// Helper to securely identify the client IP, preferring CF-Connecting-IP if behind Cloudflare
const keyGenerator = (req: Request): string => {
  return (req.headers['cf-connecting-ip'] as string) || req.ip || 'unknown';
};

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
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: getLimit('API_RATE_LIMIT_MAX', 200), // Generous limit for normal usage
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitErrorHandler,
  keyGenerator,
  store: createRedisStore('rl:api:'),
});
