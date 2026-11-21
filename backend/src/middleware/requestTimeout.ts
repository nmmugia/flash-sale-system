import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Request Timeout Middleware
 *
 * Sets a hard deadline on requests to prevent them from queueing indefinitely.
 * If a request takes longer than the deadline, abort it and return 503.
 */

const REQUEST_TIMEOUT_MS = 2000; // 2 second deadline

export function requestTimeout(req: Request, res: Response, next: NextFunction) {
  // Skip health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const startTime = Date.now();

  // Set a timeout to abort the request
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      const elapsed = Date.now() - startTime;
      logger.warn(
        { path: req.path, method: req.method, elapsed },
        'Request timeout - aborting'
      );

      res.status(503).json({
        success: false,
        error: 'Request timeout - service overloaded',
        code: 'REQUEST_TIMEOUT',
      });
    }
  }, REQUEST_TIMEOUT_MS);

  // Clear timeout when response finishes
  res.on('finish', () => {
    clearTimeout(timeoutId);
  });

  // Clear timeout on error
  res.on('close', () => {
    clearTimeout(timeoutId);
  });

  next();
}
