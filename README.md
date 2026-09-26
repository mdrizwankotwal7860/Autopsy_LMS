# Virtual Autopsy Online Training LMS - Backend

This is the production-grade backend for the Virtual Autopsy Online Training LMS. It is built using Node.js, Express, TypeScript, Prisma ORM, and PostgreSQL.

## Prerequisites

- Node.js (v18+)
- PostgreSQL Database
- Upstash Redis (Optional, for caching/queues)
- Stripe Account
- Cloudflare R2 Account
- Cloudflare Stream (or Bunny.net)
- Brevo Account (for transactional emails)

## Installation

1. Clone the repository and navigate to the `backend` directory.
2. Run `npm install` to install dependencies.
3. Copy `.env.example` to `.env` and fill in the required values.

## Database Setup

1. Ensure your PostgreSQL database is running.
2. Update the `DATABASE_URL` in `.env`.
3. Run Prisma migrations:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   ```

## Development

To start the development server:
```bash
npm run dev
```

## Build & Production

To build the project:
```bash
npx tsc
```

To run in production:
```bash
npm start
```

## API Documentation

For API details, please refer to the Postman collection provided separately. Major routes include:

- `POST /api/auth/register` - Student registration
- `POST /api/auth/login` - User login
- `GET /api/users` - Admin: Get users
- `PUT /api/users/:id/eligibility` - Admin: Update user eligibility
- `GET /api/courses` - List courses
- `POST /api/payments/create-session` - Create Stripe checkout session
- `POST /api/payments/webhook` - Stripe webhook for payment fulfillment
- `POST /api/files/upload-cv` - Upload CV to Cloudflare R2

## Deployment Instructions

### Railway / Render Deployment
1. Connect your GitHub repository to Railway or Render.
2. Set the build command to `npm install && npx prisma generate && npx tsc`.
3. Set the start command to `node dist/server.js`.
4. Provide all environment variables in the project settings.
5. Setup the Stripe Webhook URL in Stripe Dashboard pointing to `https://your-domain.com/api/payments/webhook` and update `STRIPE_WEBHOOK_SECRET` in environment variables.

### Database Migration on Production
Run `npx prisma migrate deploy` as part of the build/release step in your deployment platform to apply pending migrations.

## Security
- Passwords hashed via `bcryptjs`.
- Session management via `JWT`.
- Authorizations validated per API route.
- File access is strictly controlled. Private files like CVs are generated via pre-signed S3/R2 URLs.

## Project Structure
- `/src/controllers`: Request handlers
- `/src/routes`: API route definitions
- `/src/middleware`: Custom middleware (auth, error handling, validation)
- `/src/integrations`: External APIs (Stripe, R2)
- `/src/utils`: Utilities and Prisma singleton
- `/prisma`: Schema definition for DB
