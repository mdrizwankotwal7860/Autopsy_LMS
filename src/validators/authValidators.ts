import { body } from 'express-validator';

export const registerValidator = [
  body('email').isEmail().withMessage('Please provide a valid email').isLength({ max: 255 }),
  body('password').isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters long'),
  body('name').notEmpty().withMessage('Name is required').isLength({ max: 255 }),
  body('phone').optional().isString().isLength({ max: 255 }),
  body('qualification').optional().isString().isLength({ max: 255 }),
  body('professionalRole').optional().isString().isLength({ max: 255 }),
  body('organization').optional().isString().isLength({ max: 255 }),
];

export const loginValidator = [
  body('email').isEmail().withMessage('Please provide a valid email').isLength({ max: 255 }),
  body('password').notEmpty().withMessage('Password is required').isLength({ max: 72 }),
];

export const verifyEmailValidator = [
  body('token').isString().withMessage('Token is required').isLength({ max: 255 }),
];

export const resendVerificationValidator = [
  body('email').isEmail().withMessage('Please provide a valid email').isLength({ max: 255 }),
];

export const forgotPasswordValidator = [
  body('email').isEmail().withMessage('Please provide a valid email').isLength({ max: 255 }),
];

export const resetPasswordValidator = [
  body('token').isString().withMessage('Token is required').isLength({ max: 255 }),
  body('newPassword').isLength({ min: 8, max: 72 }).withMessage('Password must be between 8 and 72 characters long'),
];
