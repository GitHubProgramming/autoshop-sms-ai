import { Router } from 'express';

const router = Router();

/**
 * Health check endpoint
 * Responds to "are you alive?" type queries
 */
router.get('/alive', (req, res) => {
  res.json({
    status: 'alive',
    message: 'Hi! Yes, I am alive and running.',
    timestamp: new Date().toISOString()
  });
});

router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

export default router;
