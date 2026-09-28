import { Router } from 'express';
import { createPaymentSession, handleStripeWebhook } from '../controllers/paymentController';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body } from 'express-validator';
import { validate } from '../middleware/validate';
import express from 'express';

const router = Router();

// Webhook needs raw body, not JSON parsed body. It must be before express.json() if mounted globally, or we handle raw body here.
// But since app.use(express.json()) is in app.ts, we need to bypass it for the webhook.
// Let's assume we'll fix the webhook route in app.ts directly to use express.raw().
// Here we just define the routes.

router.post('/create-session', authenticate, body('courseId').isUUID().withMessage('courseId must be a valid UUID'), validate, asyncHandler(createPaymentSession));

export default router;
