import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes';
import userRoutes from './routes/userRoutes';
import courseRoutes from './routes/courseRoutes';
import paymentRoutes from './routes/paymentRoutes';
import fileRoutes from './routes/fileRoutes';
import enrollmentRoutes from './routes/enrollmentRoutes';
import progressRoutes from './routes/progressRoutes';
import { handleStripeWebhook } from './controllers/paymentController';
import { errorMiddleware } from './middleware/errorMiddleware';
import { NotFoundError } from './utils/errors';
import { apiLimiter } from './middleware/rateLimiter';

const app: Express = express();

// Trust proxy for rate limiting (Cloudflare, Railway, Render)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Stripe Webhook (must be before express.json)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

// Global API Rate Limiter
app.use('/api', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/progress', progressRoutes);

// Basic health check route
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', message: 'LMS Backend is running' });
});

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(new NotFoundError(`Route ${req.originalUrl} not found`));
});

// Error handling middleware
app.use(errorMiddleware);

export default app;
