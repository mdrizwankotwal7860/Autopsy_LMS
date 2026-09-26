import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('FATAL ERROR: JWT_SECRET is not defined in environment variables.');
}

const JWT_EXPIRES_IN = '15m'; // Short-lived access token

export interface TokenPayload {
  userId: string;
  role: string;
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};

export const generateRefreshToken = (): string => {
  return crypto.randomBytes(40).toString('hex');
};

export const hashToken = (token: string): string => {
  return crypto.createHash('sha256').update(token).digest('hex');
};
