import Redis from 'ioredis';
import { logger } from '../config/logger';
import { circuitBreaker } from '../utils/circuitBreaker';

/**
 * Metrics Service
 * 
 * Tracks and exposes system performance metrics:
 * - Total requests
 * - Successful purchases
 * - Circuit breaker effectiveness
 * - Queue depth
 */

const METRICS_KEY_PREFIX = 'metrics:';

export class MetricsService {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Increment request counter
   */
  async incrementRequests(): Promise<void> {
    await this.redis.incr(`${METRICS_KEY_PREFIX}requests`);
  }

  /**
   * Increment purchases counter
   */
  async incrementPurchases(): Promise<void> {
    await this.redis.incr(`${METRICS_KEY_PREFIX}purchases`);
  }

  /**
   * Get all metrics
   */
  async getMetrics() {
    try {
      const [requests, purchases] = await Promise.all([
        this.redis.get(`${METRICS_KEY_PREFIX}requests`),
        this.redis.get(`${METRICS_KEY_PREFIX}purchases`),
      ]);

      const cbMetrics = circuitBreaker.getMetrics();

      return {
        requests: requests ? parseInt(requests, 10) : 0,
        purchases: purchases ? parseInt(purchases, 10) : 0,
        circuitBreakerHits: cbMetrics.hits,
        circuitBreakerMisses: cbMetrics.misses,
        circuitBreakerHitRate: cbMetrics.hitRate,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get metrics');
      throw error;
    }
  }

  /**
   * Reset metrics (for testing)
   */
  async resetMetrics(): Promise<void> {
    await this.redis.del(`${METRICS_KEY_PREFIX}requests`);
    await this.redis.del(`${METRICS_KEY_PREFIX}purchases`);
    circuitBreaker.resetMetrics();
    logger.info('Metrics reset');
  }
}
