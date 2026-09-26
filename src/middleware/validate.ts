import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { BadRequestError } from '../utils/errors';

export const validate = (req: Request, res: Response, next: NextFunction) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg).join(', ');
    return next(new BadRequestError(`Validation failed: ${errorMessages}`));
  }
  next();
};
