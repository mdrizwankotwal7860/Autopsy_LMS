import { Router } from 'express';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { param } from 'express-validator';
import { validate } from '../middleware/validate';
import {
  generateCertificate,
  listCertificates,
  getCertificate,
  verifyCertificate
} from '../controllers/certificateController';

const router = Router({ mergeParams: true });

// Public verification endpoint
router.get('/verify/:uniqueId', param('uniqueId').isString().notEmpty().isLength({ max: 255 }).withMessage('Invalid certificate id'), validate, asyncHandler(verifyCertificate));

// All other routes require authentication
router.use(authenticate);

// Generate/get certificate for a specific course
// Expected to be mounted on /api/courses/:courseId/certificates
router.post('/', asyncHandler(generateCertificate));

// List authenticated user's certificates
// Expected to be mounted on /api/certificates
router.get('/', asyncHandler(listCertificates));

// Get specific certificate securely
// Expected to be mounted on /api/certificates/:id
router.get('/:id', param('id').isUUID().withMessage('Invalid certificate id'), validate, asyncHandler(getCertificate));

export default router;
