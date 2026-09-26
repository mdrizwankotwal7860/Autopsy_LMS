import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import prisma from '../utils/prisma';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    eligibilityStatus: string;
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    let token;
    
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new UnauthorizedError('Not authorized to access this route'));
    }

    const decoded = verifyToken(token);
    
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, eligibilityStatus: true }
    });

    if (!user) {
      return next(new UnauthorizedError('User no longer exists'));
    }

    req.user = {
      id: user.id,
      role: user.role,
      eligibilityStatus: user.eligibilityStatus
    };
    
    next();
  } catch (error) {
    return next(new UnauthorizedError('Not authorized to access this route'));
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new ForbiddenError(`User role ${req.user?.role} is not authorized to access this route`));
    }
    next();
  };
};
