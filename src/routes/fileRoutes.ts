import { Router } from 'express';
import multer from 'multer';
import { uploadCV, getProtectedFile } from '../controllers/fileController';
import { authenticate } from '../middleware/authMiddleware';
import { asyncHandler } from '../middleware/asyncHandler';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

// Require authentication for all file routes
router.use(authenticate);

router.post('/upload-cv', upload.single('cv'), asyncHandler(uploadCV));
router.get('/protected-file', asyncHandler(getProtectedFile));

export default router;
