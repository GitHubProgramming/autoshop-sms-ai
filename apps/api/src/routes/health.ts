import { Request, Response } from 'express';

/**
 * Health check endpoint to verify if the system is working
 * Responds to "Ar vis dar dirba?" (Does everything still work?)
 */
export const healthCheck = async (req: Request, res: Response) => {
  try {
    const healthStatus = {
      status: 'ok',
      message: 'Taip, vis dar dirba!', // Yes, still working!
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development'
    };

    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Ne, kažkas negerai', // No, something is wrong
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
