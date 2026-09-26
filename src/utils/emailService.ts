export const sendEmail = async (to: string, subject: string, htmlContent: string) => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.EMAIL_FROM || 'noreply@virtualautopsy.com';

  if (!apiKey) {
    console.warn('BREVO_API_KEY is missing. Email not sent.');
    return;
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': apiKey
      },
      body: JSON.stringify({
        sender: { email: senderEmail, name: 'LMS Platform' },
        to: [{ email: to }],
        subject,
        htmlContent
      })
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Brevo Email Failure [Status: ${response.status}]: ${errorData}`);
    }
  } catch (error: any) {
    console.error(`Failed to dispatch email: ${error.message}`);
  }
};

export const sendVerificationEmail = async (to: string, token: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const verificationLink = `${frontendUrl}/verify-email?token=${token}`;
  
  const subject = 'Verify your email address';
  const htmlContent = `
    <h2>Welcome to the LMS Platform</h2>
    <p>Please verify your email address by clicking the link below:</p>
    <a href="${verificationLink}">Verify Email</a>
    <p>If you did not request this, please ignore this email.</p>
    <p>This link will expire in 24 hours.</p>
  `;

  // We explicitly fire-and-forget this to avoid blocking the HTTP response
  sendEmail(to, subject, htmlContent).catch(err => console.error(err));
};

export const sendPasswordResetEmail = async (to: string, token: string) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const resetLink = `${frontendUrl}/reset-password?token=${token}`;
  
  const subject = 'Password Reset Request';
  const htmlContent = `
    <h2>Password Reset</h2>
    <p>We received a request to reset your password. Click the link below to set a new password:</p>
    <a href="${resetLink}">Reset Password</a>
    <p>If you did not request this, please ignore this email. Your password will remain unchanged.</p>
    <p>This link will expire in 15 minutes.</p>
  `;

  // We explicitly fire-and-forget this to avoid blocking the HTTP response
  sendEmail(to, subject, htmlContent).catch(err => console.error(err));
};
