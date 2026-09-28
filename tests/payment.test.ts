// @ts-nocheck
import request from 'supertest';
jest.mock('uuid', () => ({ v4: jest.fn() }));
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { stripe } from '../src/integrations/stripe/stripeService';
import jwt from 'jsonwebtoken';

jest.mock('../src/utils/prisma', () => ({
  user: { findUnique: jest.fn() },
  course: { findUnique: jest.fn() },
  enrollment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  payment: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn((callback) => callback(prisma))
}));

jest.mock('../src/integrations/stripe/stripeService', () => ({
  stripe: {
    webhooks: {
      constructEvent: jest.fn()
    },
    checkout: {
      sessions: {
        create: jest.fn(),
        retrieve: jest.fn()
      }
    }
  },
  createCheckoutSession: jest.fn()
}));

const mockPrisma = prisma as jest.Mocked<typeof prisma>;

// Valid UUID constants for test IDs
const USER_ID = '10000000-0000-4000-8000-000000000001';
const COURSE_ID = '20000000-0000-4000-8000-000000000001';
const WRONG_COURSE_ID = '20000000-0000-4000-8000-000000000099';
const PAYMENT_ID = '70000000-0000-4000-8000-000000000001';
const RECENT_PAYMENT_ID = '70000000-0000-4000-8000-000000000002';
const ENROLLMENT_ID = '80000000-0000-4000-8000-000000000001';

describe('Payment & Stripe Security', () => {
  let token: string;
  const mockUser = {
    id: USER_ID,
    email: 'test@example.com',
    eligibilityStatus: 'APPROVED',
    isEmailVerified: true
  };

  const mockCourse = {
    id: COURSE_ID,
    title: 'Autopsy 101',
    price: 150.00,
    status: 'PUBLISHED'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    token = jwt.sign({ id: mockUser.id, role: 'STUDENT' }, process.env.JWT_SECRET || 'test_secret_for_jwt_which_must_exist');
    
    // Default mocks
    mockPrisma.user.findUnique.mockResolvedValue(mockUser as any);
    mockPrisma.course.findUnique.mockResolvedValue(mockCourse as any);
    mockPrisma.payment.findFirst.mockResolvedValue(null); // No recent payment
    mockPrisma.payment.findUnique.mockResolvedValue(null);
    mockPrisma.payment.create.mockResolvedValue({ id: PAYMENT_ID } as any);
    mockPrisma.enrollment.findUnique.mockResolvedValue(null);

    (stripe.checkout.sessions.create as jest.Mock).mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/...'
    });
    const { createCheckoutSession } = require('../src/integrations/stripe/stripeService');
    (createCheckoutSession as jest.Mock).mockResolvedValue({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/...'
    });
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
  });

  describe('createPaymentSession', () => {
    it('Unverified user cannot create Stripe checkout', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, isEmailVerified: false } as any);
      
      const res = await request(app)
        .post('/api/payments/create-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: mockCourse.id });
        
      expect(res.statusCode).toBe(403);
      expect(res.text).toMatch(/verify your email/i);
    });

    it('Client cannot choose an arbitrary course price', async () => {
      const res = await request(app)
        .post('/api/payments/create-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: mockCourse.id, price: 1.00 }); // Attempting to pay $1

      expect(res.statusCode).toBe(200);
      
      // Verify createCheckoutSession was called with DB price (150), NOT client price (1)
      const { createCheckoutSession } = require('../src/integrations/stripe/stripeService');
      expect(createCheckoutSession).toHaveBeenCalledWith(
        mockUser.id,
        mockUser.email,
        mockCourse.id,
        mockCourse.title,
        mockCourse.price, // 150
        expect.any(String) // idempotency key
      );
    });

    it('Repeated checkout creation within 15 mins returns existing session', async () => {
      mockPrisma.payment.findFirst.mockResolvedValue({
        id: RECENT_PAYMENT_ID,
        stripeSessionId: 'cs_test_recent',
        createdAt: new Date()
      } as any);

      (stripe.checkout.sessions.retrieve as jest.Mock).mockResolvedValue({
        id: 'cs_test_recent',
        status: 'open',
        url: 'https://checkout.stripe.com/existing'
      });

      const res = await request(app)
        .post('/api/payments/create-session')
        .set('Authorization', `Bearer ${token}`)
        .send({ courseId: mockCourse.id });

      expect(res.statusCode).toBe(200);
      expect(res.body.url).toBe('https://checkout.stripe.com/existing');
      expect(stripe.checkout.sessions.create).not.toHaveBeenCalled(); // No new session created
    });
  });

  describe('Webhook Security', () => {
    const rawBody = JSON.stringify({ type: 'checkout.session.completed' });

    it('Invalid Stripe signature is rejected', async () => {
      (stripe.webhooks.constructEvent as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid signature');
      });

      const res = await request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', 'invalid-sig')
        .send(rawBody);

      expect(res.statusCode).toBe(400);
      expect(res.text).toMatch(/Webhook Error: Invalid signature/);
    });

    it('Missing Stripe signature is rejected', async () => {
      const res = await request(app)
        .post('/api/payments/webhook')
        .send(rawBody);

      expect(res.statusCode).toBe(400);
      expect(res.text).toMatch(/Webhook signature missing/);
    });

    const triggerValidWebhook = async (sessionData: any) => {
      (stripe.webhooks.constructEvent as jest.Mock).mockReturnValue({
        type: 'checkout.session.completed',
        data: { object: sessionData }
      });

      return request(app)
        .post('/api/payments/webhook')
        .set('stripe-signature', 'valid-sig')
        .set('Content-Type', 'application/json') // Express.raw will parse this because of the route definition
        .send(rawBody);
    };

    it('Correct amount activates enrollment', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'PENDING',
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      mockPrisma.payment.updateMany.mockResolvedValue({ count: 1 } as any); // Simulate success lock
      mockPrisma.enrollment.create.mockResolvedValue({ id: ENROLLMENT_ID } as any);

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 15000, // 150.00 GBP in pence
        currency: 'gbp',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: mockCourse.id }
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'SUCCESS', stripePaymentId: 'pi_123' } })
      );
      expect(mockPrisma.enrollment.create).toHaveBeenCalled();
    });

    it('Incorrect/lower amount does NOT activate enrollment', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'PENDING',
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 10000, // 100.00 GBP in pence (too low!)
        currency: 'gbp',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: mockCourse.id }
      });

      expect(res.statusCode).toBe(200); // Successfully rejected, returns 200 to stop retries
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } })
      );
    });

    it('Incorrect currency does NOT activate enrollment', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'PENDING',
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 15000,
        currency: 'usd', // Wrong currency!
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: mockCourse.id }
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('Incorrect course metadata does NOT activate enrollment', async () => {
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'PENDING',
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 15000,
        currency: 'gbp',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: WRONG_COURSE_ID } // Mismatched course
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('Duplicate webhook does not create duplicate enrollment', async () => {
      // First webhook
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'SUCCESS', // ALREADY SUCCESS!
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 15000,
        currency: 'gbp',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: mockCourse.id }
      });

      expect(res.statusCode).toBe(200);
      // Ensure updateMany was never called because it stopped early
      expect(mockPrisma.payment.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled();
    });

    it('Repeated successful webhook does not corrupt payment state (concurrent handling)', async () => {
      // Simulate that the payment was PENDING when retrieved, but updateMany returned 0 count
      // because another process *just* updated it
      mockPrisma.payment.findUnique.mockResolvedValue({
        id: PAYMENT_ID,
        amount: 150.00,
        currency: 'GBP',
        status: 'PENDING',
        userId: mockUser.id,
        courseId: mockCourse.id
      } as any);

      mockPrisma.payment.updateMany.mockResolvedValue({ count: 0 } as any); // CONCURRENT LOCK FAILED

      const res = await triggerValidWebhook({
        id: 'cs_test_123',
        amount_total: 15000,
        currency: 'gbp',
        payment_status: 'paid',
        payment_intent: 'pi_123',
        metadata: { userId: mockUser.id, courseId: mockCourse.id }
      });

      expect(res.statusCode).toBe(200);
      expect(mockPrisma.enrollment.create).not.toHaveBeenCalled(); // Safely aborted!
    });
  });
});
