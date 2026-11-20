import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from './errorHandler';
import { monitorEventLoopDelay } from 'perf_hooks';

/**
 * Load Shedding Middleware
 * 
 * Monitors system health (event loop lag and memory usage) and rejects
 * requests with 503 when the system is degraded. This prevents cascade
 * failures and ensures graceful degradation under extreme load.
 * 
 * Prioritizes:
 * - Completing existing orders over accepting new ones
 * - System stability over throughput
 */

// Event loop lag monitoring
const h = monitorEventLoopDelay();
h.enable();

let currentEventLoopLag = 0;
let currentMemoryUsage = 0;

// Update metrics periodically
setInterval(() => {
  currentEventLoopLag = h.mean / 1e6; // Convert to milliseconds
  currentMemoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100;
}, 1000);

/**
 * Check if system is overloaded
 */
function isSystemOverloaded(): { overloaded: boolean; reason?: string } {
  // Check event loop lag
  if (currentEventLoopLag > env.MAX_EVENT_LOOP_LAG_MS) {
    return {
      overloaded: true,
      reason: `Event loop lag ${currentEventLoopLag.toFixed(2)}ms exceeds threshold ${env.MAX_EVENT_LOOP_LAG_MS}ms`,
    };
  }

  // Check memory usage
  if (currentMemoryUsage > env.MAX_MEMORY_USAGE_PERCENT) {
    return {
      overloaded: true,
      reason: `Memory usage ${currentMemoryUsage.toFixed(2)}% exceeds threshold ${env.MAX_MEMORY_USAGE_PERCENT}%`,
    };
  }

  return { overloaded: false };
}

/**
 * Load shedding middleware
 */
export function loadSheddingMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Skip for health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  const systemStatus = isSystemOverloaded();

  if (systemStatus.overloaded) {
    logger.warn(
      {
        path: req.path,
        method: req.method,
        eventLoopLag: currentEventLoopLag,
        memoryUsage: currentMemoryUsage,
        reason: systemStatus.reason,
      },
      'Request rejected due to system overload'
    );

    throw new AppError(
      503,
      'System overloaded, please retry',
      'SYSTEM_OVERLOADED',
      {
        eventLoopLag: currentEventLoopLag,
        memoryUsage: currentMemoryUsage,
        reason: systemStatus.reason,
      }
    );
  }

  next();
}

/**
 * Get current system metrics
 */
export function getSystemMetrics() {
  return {
    eventLoopLag: currentEventLoopLag,
    memoryUsage: currentMemoryUsage,
    maxEventLoopLag: env.MAX_EVENT_LOOP_LAG_MS,
    maxMemoryUsage: env.MAX_MEMORY_USAGE_PERCENT,
  };
}
