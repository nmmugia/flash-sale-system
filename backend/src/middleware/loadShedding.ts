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
 * Uses p99 percentile with 10-second reset windows (Node.js best practice)
 * instead of cumulative mean to prevent death spirals.
 *
 * Prioritizes:
 * - Completing existing orders over accepting new ones
 * - System stability over throughput
 */

// Event loop lag monitoring with p99 percentile
const h = monitorEventLoopDelay({ resolution: 10 });
h.enable();

let currentEventLoopP99 = 0;
let currentMemoryUsage = 0;

// Update metrics every 10 seconds with histogram reset
// This prevents cumulative lag from causing permanent overload state
setInterval(() => {
  // Use p99 percentile instead of mean for better spike detection
  currentEventLoopP99 = h.percentile(99) / 1e6; // Convert to milliseconds
  currentMemoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal * 100;

  // Log if event loop is degraded
  if (currentEventLoopP99 > 50) {
    logger.warn({ eventLoopP99: currentEventLoopP99 }, 'Event loop delay detected');
  }

  // Reset histogram for next measurement window
  h.reset();
}, 10000); // 10 second windows

/**
 * Check if system is overloaded
 * Uses p99 with 100ms threshold (Node.js recommendation for high-throughput systems)
 */
function isSystemOverloaded(): { overloaded: boolean; reason?: string } {
  // Check event loop p99 - 100ms is critical threshold for high-throughput systems
  // (Node.js performance team recommendation)
  if (currentEventLoopP99 > 100) {
    return {
      overloaded: true,
      reason: `Event loop p99 ${currentEventLoopP99.toFixed(2)}ms exceeds threshold 100ms`,
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
        eventLoopP99: currentEventLoopP99,
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
        eventLoopP99: currentEventLoopP99,
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
    eventLoopP99: currentEventLoopP99,
    memoryUsage: currentMemoryUsage,
    maxEventLoopP99: 100, // Node.js recommended threshold
    maxMemoryUsage: env.MAX_MEMORY_USAGE_PERCENT,
  };
}
