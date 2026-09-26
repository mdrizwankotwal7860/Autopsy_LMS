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

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course not found');
  if (course.status !== 'PUBLISHED') throw new BadRequestError('Course is not available');

  const existingEnrollment = await prisma.enrollment.findUnique({
    where: { userId_courseId: { userId, courseId } }
  });

  if (existingEnrollment && existingEnrollment.status === 'ACTIVE') {
    throw new ConflictError('You are already enrolled in this course');
  }

  const session = await createCheckoutSession(
    user.id,
    user.email,
    course.id,
    course.title,
    Number(course.price)
  );

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

  res.status(200).json({ sessionId: session.id, url: session.url });
};

export const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig as string, endpointSecret as string);
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as any;
    
    const userId = session.metadata.userId;
    const courseId = session.metadata.courseId;
    const paymentId = session.payment_intent;

    // Use a transaction to prevent race conditions and duplicate enrollments
    await prisma.$transaction(async (tx: any) => {
      const payment = await tx.payment.findUnique({
        where: { stripeSessionId: session.id }
      });

      if (!payment) return;
      if (payment.status === 'SUCCESS') return; // Already processed

      // Update payment
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESS',
          stripePaymentId: paymentId
        }
      });

      // Create enrollment if not exists
      const existingEnrollment = await tx.enrollment.findUnique({
        where: { userId_courseId: { userId, courseId } }
      });

      let enrollmentId;

      if (!existingEnrollment) {
        const enrollment = await tx.enrollment.create({
          data: {
            userId,
            courseId,
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

      // Link payment to enrollment
      await tx.payment.update({
        where: { id: payment.id },
        data: { enrollmentId }
      });

      // TODO: Send confirmation email
    });
  }

  res.status(200).json({ received: true });
};
