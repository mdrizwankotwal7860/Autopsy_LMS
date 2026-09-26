import { body } from 'express-validator';

export const registerValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
  body('name').notEmpty().withMessage('Name is required'),
  body('phone').optional().isString(),
  body('qualification').optional().isString(),
  body('professionalRole').optional().isString(),
  body('organization').optional().isString(),
];

export const loginValidator = [
  body('email').isEmail().withMessage('Please provide a valid email'),
  body('password').notEmpty().withMessage('Password is required'),
];
