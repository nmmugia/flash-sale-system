import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { logger } from '../config/logger';

/**
 * Rate Limiting Middleware using Token Bucket Algorithm
 *
 * Based on Stripe's rate limiting approach:
 * - Sliding window counters for accurate rate limiting
 * - Per-user limits to prevent single user from consuming all stock
 * - Global limits to protect system capacity
 * - Standard rate limit headers (X-RateLimit-*)
 */

interface RateLimitConfig {
  maxRequests: number;       // Max requests per window
  windowSeconds: number;     // Time window in seconds
  globalMaxRequests?: number; // Optional global limit
}

class TokenBucketRateLimiter {
  constructor(
    private redis: Redis,
    private config: RateLimitConfig
  ) {}

  /**
   * Check rate limit for a specific user using sliding window
   */
  async checkRateLimit(userId: string): Promise<{
    allowed: boolean;
    remaining: number;
    resetAt: number;
  }> {
    const now = Date.now();
    const windowStart = now - (this.config.windowSeconds * 1000);
    const userKey = `ratelimit:user:${userId}`;

    try {
      // Use sorted set for sliding window (more accurate than fixed window)
      const multi = this.redis.multi();

      // Remove old entries outside window
      multi.zremrangebyscore(userKey, 0, windowStart);

      // Count requests in current window
      multi.zcard(userKey);

      // Add current request timestamp
      multi.zadd(userKey, now, `${now}-${Math.random()}`);

      // Set expiry on key
      multi.expire(userKey, this.config.windowSeconds);

      const results = await multi.exec();
      const count = (results?.[1]?.[1] as number) || 0;

      const allowed = count < this.config.maxRequests;
      const remaining = Math.max(0, this.config.maxRequests - count - 1);
      const resetAt = now + (this.config.windowSeconds * 1000);

      return { allowed, remaining, resetAt };
    } catch (error) {
      logger.error({ error, userId }, 'Rate limit check failed');
      // Fail open: allow request if Redis fails
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: now + (this.config.windowSeconds * 1000),
      };
    }
  }

  /**
   * Check global rate limit using simple counter
   */
  async checkGlobalRateLimit(): Promise<{
    allowed: boolean;
    current: number;
  }> {
    if (!this.config.globalMaxRequests) {
      return { allowed: true, current: 0 };
    }

    const globalKey = `ratelimit:global:${Math.floor(Date.now() / (this.config.windowSeconds * 1000))}`;

    try {
      const count = await this.redis.incr(globalKey);

      // Set expiry on first increment
      if (count === 1) {
        await this.redis.expire(globalKey, this.config.windowSeconds);
      }

      return {
        allowed: count <= this.config.globalMaxRequests,
        current: count,
      };
    } catch (error) {
      logger.error({ error }, 'Global rate limit check failed');
      // Fail open: allow request if Redis fails
      return { allowed: true, current: 0 };
    }
  }
}

/**
 * Create rate limiting middleware
 */
export function rateLimitMiddleware(
  redis: Redis,
  config: RateLimitConfig
) {
  const limiter = new TokenBucketRateLimiter(redis, config);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip for health checks
    if (req.path === '/health' || req.path === '/ready') {
      return next();
    }

    // Extract user ID from request
    const userId = req.body?.userId || req.headers['x-user-id'] as string;

    // If no user ID, skip user-level rate limiting
    // (could implement IP-based rate limiting here instead)
    if (!userId) {
      // Check global rate limit only
      try {
        const globalLimit = await limiter.checkGlobalRateLimit();

        if (!globalLimit.allowed) {
          return res.status(429).json({
            success: false,
            error: 'System rate limit exceeded',
            code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
            retryAfter: config.windowSeconds,
          });
        }
      } catch (error) {
        logger.error({ error }, 'Global rate limit check error');
        // Fail open: continue with request
      }

      return next();
    }

    try {
      // Check user rate limit
      const userLimit = await limiter.checkRateLimit(userId);

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': config.maxRequests.toString(),
        'X-RateLimit-Remaining': userLimit.remaining.toString(),
        'X-RateLimit-Reset': Math.floor(userLimit.resetAt / 1000).toString(),
      });

      if (!userLimit.allowed) {
        logger.warn(
          { userId, path: req.path },
          'User rate limit exceeded'
        );

        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMIT_EXCEEDED',
          retryAfter: Math.ceil((userLimit.resetAt - Date.now()) / 1000),
        });
      }

      // Check global rate limit
      const globalLimit = await limiter.checkGlobalRateLimit();

      if (!globalLimit.allowed) {
        logger.warn(
          { globalCurrent: globalLimit.current, globalMax: config.globalMaxRequests },
          'Global rate limit exceeded'
        );

        return res.status(429).json({
          success: false,
          error: 'System rate limit exceeded',
          code: 'GLOBAL_RATE_LIMIT_EXCEEDED',
          retryAfter: config.windowSeconds,
        });
      }

      next();
    } catch (error) {
      logger.error({ error, userId }, 'Rate limit middleware error');
      // Fail open: don't block request if rate limiting fails
      next();
    }
  };
}

/**
 * Default rate limit configuration for flash sales
 *
 * Per-user: 10 requests per 10 seconds (1 req/s sustained)
 * Global: 2000 req/s (allows 4 API instances × 500 req/s each)
 */
export const defaultRateLimitConfig: RateLimitConfig = {
  maxRequests: 10,           // 10 requests per user
  windowSeconds: 10,         // Per 10 seconds
  globalMaxRequests: 2000,   // 2000 req/s system-wide
};
