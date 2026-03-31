import { Request, Response } from 'express';

/**
 * Simple ping endpoint for testing
 */
export const ping = (req: Request, res: Response) => {
  res.json({
    message: 'pong',
    timestamp: new Date().toISOString(),
    status: 'ok'
  });
};

export default ping;
