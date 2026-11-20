import { Request, Response, NextFunction } from 'express';
import { monitorEventLoopDelay } from 'perf_hooks';
import { logger } from '../config/logger';
import { AppError } from './errorHandler';

/**
 * Adaptive Load Shedding Middleware
 *
 * Based on Google SRE patterns for graceful degradation:
 * - Uses multiple signals (event loop, error rate, queue depth)
 * - Probabilistic rejection (shed 30-50%, not 100%)
 * - Gradually adjusts rejection rate (no sudden jumps)
 * - Self-healing (automatically recovers as system stabilizes)
 *
 * This prevents death spirals where load shedding makes things worse.
 */

interface LoadMetrics {
  eventLoopP99: number;
  queueDepth: number;
  errorRate: number;
  timestamp: number;
}

class AdaptiveLoadShedder {
  private h = monitorEventLoopDelay({ resolution: 10 });
  private requestQueue: number = 0;
  private recentErrors: number = 0;
  private recentRequests: number = 0;
  private rejectionRate: number = 0; // 0.0 to 1.0
  private currentMetrics: LoadMetrics;

  constructor() {
    this.h.enable();

    this.currentMetrics = {
      eventLoopP99: 0,
      queueDepth: 0,
      errorRate: 0,
      timestamp: Date.now(),
    };

    // Update metrics every 10 seconds
    setInterval(() => {
      this.updateMetrics();
    }, 10000);

    // Adjust rejection rate every 5 seconds
    setInterval(() => {
      this.adjustRejectionRate();
    }, 5000);
  }

  private updateMetrics(): LoadMetrics {
    const metrics: LoadMetrics = {
      eventLoopP99: this.h.percentile(99) / 1e6, // Convert to milliseconds
      queueDepth: this.requestQueue,
      errorRate: this.recentRequests > 0
        ? this.recentErrors / this.recentRequests
        : 0,
      timestamp: Date.now(),
    };

    // Log if event loop is degraded
    if (metrics.eventLoopP99 > 50) {
      logger.warn(
        {
          eventLoopP99: metrics.eventLoopP99,
          queueDepth: metrics.queueDepth,
          errorRate: metrics.errorRate,
        },
        'Event loop delay detected'
      );
    }

    // Reset histogram for next measurement window
    this.h.reset();

    // Reset counters for next window
    this.recentErrors = 0;
    this.recentRequests = 0;

    this.currentMetrics = metrics;
    return metrics;
  }

  private adjustRejectionRate(): void {
    const metrics = this.updateMetrics();
    let targetRejection = 0;

    // Signal 1: Event loop significantly degraded (>100ms p99)
    // Node.js recommendation: 100ms is critical threshold for high-throughput systems
    if (metrics.eventLoopP99 > 100) {
      targetRejection = Math.max(targetRejection, 0.3); // Shed 30%
      logger.warn(
        { eventLoopP99: metrics.eventLoopP99 },
        'Event loop critical - enabling load shedding'
      );
    } else if (metrics.eventLoopP99 > 50) {
      // Warning level - light shedding
      targetRejection = Math.max(targetRejection, 0.1); // Shed 10%
    }

    // Signal 2: High error rate (>50% errors)
    if (metrics.errorRate > 0.5 && this.recentRequests > 10) {
      targetRejection = Math.max(targetRejection, 0.5); // Shed 50%
      logger.warn(
        { errorRate: metrics.errorRate },
        'High error rate - enabling load shedding'
      );
    } else if (metrics.errorRate > 0.3 && this.recentRequests > 10) {
      targetRejection = Math.max(targetRejection, 0.2); // Shed 20%
    }

    // Signal 3: Queue depth exceeds capacity
    if (metrics.queueDepth > 1000) {
      targetRejection = Math.max(targetRejection, 0.4); // Shed 40%
      logger.warn(
        { queueDepth: metrics.queueDepth },
        'Queue depth critical - enabling load shedding'
      );
    } else if (metrics.queueDepth > 500) {
      targetRejection = Math.max(targetRejection, 0.2); // Shed 20%
    }

    // Gradually adjust rejection rate (don't jump immediately)
    const previousRate = this.rejectionRate;

    if (targetRejection > this.rejectionRate) {
      // Increase rejection rate quickly (system in trouble)
      this.rejectionRate = Math.min(
        this.rejectionRate + 0.1,
        targetRejection
      );
    } else {
      // Decrease rejection rate slowly (recover gradually)
      this.rejectionRate = Math.max(
        this.rejectionRate - 0.05,
        targetRejection,
        0
      );
    }

    // Log rate changes
    if (Math.abs(this.rejectionRate - previousRate) > 0.01) {
      logger.info(
        {
          previousRate,
          newRate: this.rejectionRate,
          eventLoopP99: metrics.eventLoopP99,
          errorRate: metrics.errorRate,
          queueDepth: metrics.queueDepth,
        },
        'Load shedding rate adjusted'
      );
    }
  }

  shouldReject(): boolean {
    // Probabilistic rejection based on current rejection rate
    return Math.random() < this.rejectionRate;
  }

  incrementQueue(): void {
    this.requestQueue++;
  }

  decrementQueue(): void {
    this.requestQueue--;
  }

  recordRequest(): void {
    this.recentRequests++;
  }

  recordError(): void {
    this.recentErrors++;
  }

  getMetrics(): LoadMetrics & { rejectionRate: number } {
    return {
      ...this.currentMetrics,
      rejectionRate: this.rejectionRate,
    };
  }
}

// Singleton instance
export const adaptiveLoadShedder = new AdaptiveLoadShedder();

/**
 * Adaptive load shedding middleware
 */
export function adaptiveLoadSheddingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip for health checks
  if (req.path === '/health' || req.path === '/ready') {
    return next();
  }

  adaptiveLoadShedder.incrementQueue();
  adaptiveLoadShedder.recordRequest();

  // Probabilistic rejection based on system load
  if (adaptiveLoadShedder.shouldReject()) {
    adaptiveLoadShedder.decrementQueue();

    logger.warn(
      {
        path: req.path,
        method: req.method,
        metrics: adaptiveLoadShedder.getMetrics(),
      },
      'Request rejected by adaptive load shedding'
    );

    throw new AppError(
      503,
      'Service temporarily overloaded, please retry',
      'SERVICE_OVERLOADED',
      {
        retryAfter: 5,
        metrics: adaptiveLoadShedder.getMetrics(),
      }
    );
  }

  // Track request completion
  res.on('finish', () => {
    adaptiveLoadShedder.decrementQueue();

    // Record errors (5xx responses)
    if (res.statusCode >= 500) {
      adaptiveLoadShedder.recordError();
    }
  });

  next();
}

/**
 * Get current adaptive load shedding metrics
 */
export function getAdaptiveLoadSheddingMetrics() {
  return adaptiveLoadShedder.getMetrics();
}
