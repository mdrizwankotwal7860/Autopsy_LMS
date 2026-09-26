import Stripe from 'stripe';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || 'sk_test_...';
export const stripe = new Stripe(stripeSecretKey, {
});

export const createCheckoutSession = async (
  userId: string,
  userEmail: string,
  courseId: string,
  courseTitle: string,
  price: number,
  idempotencyKey?: string
) => {
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    customer_email: userEmail,
    client_reference_id: userId,
    metadata: {
      userId,
      courseId
    },
    line_items: [
      {
        price_data: {
          currency: 'gbp',
          product_data: {
            name: courseTitle
          },
          unit_amount: Math.round(price * 100) // Stripe expects smallest currency unit (pence)
        },
        quantity: 1
      }
    ],
    mode: 'payment',
    success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL}/courses/${courseId}`
  }, {
    idempotencyKey
  });

  return session;
};
