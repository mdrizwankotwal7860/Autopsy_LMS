import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotFoundError, BadRequestError, ForbiddenError, ConflictError } from '../utils/errors';
import { createCheckoutSession, stripe } from '../integrations/stripe/stripeService';
import { AuthRequest } from '../middleware/authMiddleware';

export const createPaymentSession = async (req: AuthRequest, res: Response) => {
  const { courseId } = req.body;
  // @ts-ignore
  const userId = req.user!.id;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User not found');

  if (user.eligibilityStatus !== 'APPROVED') {
    throw new ForbiddenError('You must be approved to purchase courses');
  }

  if (!user.isEmailVerified) {
    throw new ForbiddenError('You must verify your email before purchasing courses');
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course not found');
  if (course.status !== 'PUBLISHED') throw new BadRequestError('Course is not available');

  const existingEnrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (existingEnrollment && existingEnrollment.status === 'ACTIVE') {
    throw new ConflictError('You are already enrolled in this course');
  }

  // To prevent multiple pending Stripe sessions for rapid double-clicks, we check
  // if an active, very recent pending session exists for this user/course.
  // A Stripe session typically lasts 24h, but we only block creating a new one
  // if it's within the last 15 minutes to allow legitimate retries.
  const recentPendingPayment = await prisma.payment.findFirst({
    where: {
      userId,
      courseId,
      status: 'PENDING',
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (recentPendingPayment && recentPendingPayment.stripeSessionId) {
    // Attempt to retrieve it to get the URL
    try {
      const existingSession = await stripe.checkout.sessions.retrieve(recentPendingPayment.stripeSessionId);
      if (existingSession && existingSession.status === 'open') {
        return res.status(200).json({ sessionId: existingSession.id, url: existingSession.url });
      }
    } catch (err) {
      // If retrieval fails, ignore and create a new one
    }
  }

  // Deterministic idempotency key per 10-second window.
  // This completely stops double-click concurrency race conditions (which happen in <1s)
  // while allowing legitimate retries to generate a NEW session if the old one is unusable.
  const windowId = Math.floor(Date.now() / 10000);
  const idempotencyKey = `checkout_${userId}_${courseId}_${windowId}`;

  const session = await createCheckoutSession(
    user.id,
    user.email,
    course.id,
    course.title,
    Number(course.price),
    idempotencyKey
  );

  try {
    await prisma.payment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        amount: course.price,
        currency: 'GBP',
        status: 'PENDING',
        stripeSessionId: session.id
      }
    });
  } catch (err: any) {
    // Prisma Unique Constraint Violation (P2002) on stripeSessionId.
    // This happens if a concurrent request just created the payment for this session.
    if (err.code === 'P2002') {
      console.log('Concurrent checkout creation detected. Returning existing session.');
      // It's safe to just return the session since the other thread successfully saved it.
    } else {
      throw err;
    }
  }

  res.status(200).json({ sessionId: session.id, url: session.url });
};

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !endpointSecret) {
    return res.status(400).send('Webhook signature missing or unconfigured');
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret as string);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // We process both instant and delayed payment completions
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object as any;
    
    const metadataUserId = session.metadata?.userId;
    const metadataCourseId = session.metadata?.courseId;
    const paymentId = session.payment_intent;
    const paymentStatus = session.payment_status;
    const amountTotal = session.amount_total;
    const currency = session.currency;

    if (!metadataUserId || !metadataCourseId) {
      console.error('Webhook missing metadata');
      return res.status(400).send('Missing metadata');
    }

    if (paymentStatus !== 'paid') {
      console.log(`Payment not fully paid yet: ${paymentStatus}`);
      return res.status(200).send('Not paid yet');
    }

    try {
      await prisma.$transaction(async (tx: any) => {
        const payment = await tx.payment.findUnique({
          where: { stripeSessionId: session.id }
        });

        if (!payment) {
          throw new Error('Payment record not found');
        }

        // Idempotency: If already SUCCESS, stop early safely
        if (payment.status === 'SUCCESS') return;

        // Security Validation Boundary
        const expectedAmount = Math.round(Number(payment.amount) * 100);
        if (amountTotal !== expectedAmount) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED' }
          });
          console.error(`Amount mismatch. Expected ${expectedAmount}, got ${amountTotal}`);
          return; // Commit transaction with FAILED state
        }

        if (currency?.toLowerCase() !== payment.currency.toLowerCase()) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED' }
          });
          console.error(`Currency mismatch. Expected ${payment.currency}, got ${currency}`);
          return;
        }

        if (payment.userId !== metadataUserId || payment.courseId !== metadataCourseId) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: 'FAILED' }
          });
          console.error(`Metadata mismatch`);
          return;
        }

        // Atomically update payment to SUCCESS to prevent race conditions
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: {
            status: 'SUCCESS',
            stripePaymentId: paymentId
          }
        });

        if (count === 0) return; // Means another webhook processed it concurrently

        // Activate Enrollment
        const existingEnrollment = await tx.enrollment.findUnique({
          where: { userId_courseId: { userId: metadataUserId, courseId: metadataCourseId } }
        });

        let enrollmentId;

        if (!existingEnrollment) {
          const enrollment = await tx.enrollment.create({
            data: {
              userId: metadataUserId,
              courseId: metadataCourseId,
              status: 'ACTIVE'
            }
          });
          enrollmentId = enrollment.id;
        } else {
          const enrollment = await tx.enrollment.update({
            where: { id: existingEnrollment.id },
            data: { status: 'ACTIVE' }
          });
          enrollmentId = enrollment.id;
        }

        // Link payment to enrollment safely
        await tx.payment.update({
          where: { id: payment.id },
          data: { enrollmentId }
        });

        // TODO: Send confirmation email
      });
    } catch (err: any) {
      console.error(`Webhook Transaction Error: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }

  res.status(200).json({ received: true });
};
