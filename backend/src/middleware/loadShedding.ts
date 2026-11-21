import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';

/**
 * Load Shedding Middleware
 *
 * Sheds load when the server is under extreme pressure to prevent
 * socket timeouts and service unavailability. Returns 429/503 immediately
 * instead of letting requests hang.
 */

const MAX_EVENT_LOOP_LAG_MS = parseInt(process.env.MAX_EVENT_LOOP_LAG_MS || '100', 10);
const MAX_MEMORY_USAGE_PERCENT = parseInt(process.env.MAX_MEMORY_USAGE_PERCENT || '90', 10);

let lastEventLoopCheck = Date.now();
let eventLoopLag = 0;

// Measure event loop lag
setInterval(() => {
  const now = Date.now();
  eventLoopLag = now - lastEventLoopCheck - 100; // Expected 100ms interval
  lastEventLoopCheck = now;
}, 100);

export function loadShedding(req: Request, res: Response, next: NextFunction) {
  // Skip health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  // Check event loop lag
  if (eventLoopLag > MAX_EVENT_LOOP_LAG_MS) {
    logger.warn(
      { eventLoopLag, threshold: MAX_EVENT_LOOP_LAG_MS },
      'Shedding load due to event loop lag'
    );
    return res.status(503).json({
      success: false,
      error: 'Server overloaded, please retry',
      code: 'SERVER_OVERLOADED',
    });
  }

  // Check memory usage
  const memUsage = process.memoryUsage();
  const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

  if (memPercent > MAX_MEMORY_USAGE_PERCENT) {
    logger.warn(
      { memPercent, threshold: MAX_MEMORY_USAGE_PERCENT },
      'Shedding load due to memory pressure'
    );
    return res.status(503).json({
      success: false,
      error: 'Server overloaded, please retry',
      code: 'SERVER_OVERLOADED',
    });
  }

  next();
}

export function getLoadMetrics() {
  const memUsage = process.memoryUsage();
  return {
    eventLoopLag,
    memoryUsagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100,
    heapUsed: memUsage.heapUsed,
    heapTotal: memUsage.heapTotal,
  };
}
