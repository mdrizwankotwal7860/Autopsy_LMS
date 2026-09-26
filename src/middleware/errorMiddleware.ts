import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export const errorMiddleware = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error(`[Error] ${err.name}: ${err.message}`);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
      },
    });
  }

  // Handle Prisma errors here if needed
  if (err.code && err.code.startsWith('P')) {
    // E.g. P2002 is unique constraint violation
    if (err.code === 'P2002') {
      return res.status(409).json({
        error: { message: 'A resource with this unique value already exists' },
      });
    }
  }

  // Generic 500 error
  return res.status(500).json({
    error: {
      message: 'Internal Server Error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};
