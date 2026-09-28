import { Router } from 'express';
import multer from 'multer';
import { 
  getAssignment, 
  submitAssignment, 
  getSubmission, 
  gradeSubmission 
} from '../controllers/assignmentController';
import { authenticate, authorize } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';
import { body, param } from 'express-validator';
import { validate } from '../middleware/validate';

// We merge params so we can access courseId, moduleId, lessonId
const router = Router({ mergeParams: true });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

router.use(authenticate);

// Student routes
router.get('/', asyncHandler(getAssignment));
router.post('/submit', upload.single('file'), asyncHandler(submitAssignment));
router.get('/submission', asyncHandler(getSubmission));

// Admin routes
router.use(authorize('ADMIN'));

const gradeValidator = [
  body('marks').optional().isInt({ min: 0 }).withMessage('Marks must be a non-negative integer'),
  body('feedback').optional().isString().withMessage('Feedback must be a string').isLength({ max: 10000 })
];

router.post('/submissions/:submissionId/grade', param('submissionId').isUUID().withMessage('Invalid submissionId'), gradeValidator, validate, asyncHandler(gradeSubmission));

export default router;
