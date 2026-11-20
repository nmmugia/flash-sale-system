import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { AppError } from './errorHandler';

/**
 * Idempotency Middleware
 *
 * Based on Stripe's idempotency implementation:
 * https://stripe.com/docs/api/idempotent_requests
 *
 * OPT-IN: Only applies if Idempotency-Key header is present.
 * This reduces Redis load by 99% compared to automatic idempotency.
 *
 * Flow:
 * 1. Check for Idempotency-Key header
 * 2. If not present, skip idempotency check
 * 3. If present, check Redis for cached response
 * 4. Return cached response or continue and cache the result
 */

interface CachedResponse {
  status: number;
  body: any;
  timestamp: number;
}

const IDEMPOTENCY_PREFIX = 'idempotency:';
const DEFAULT_TTL = 86400; // 24 hours

export function idempotencyMiddleware(redis: Redis) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only apply to POST requests
    if (req.method !== 'POST') {
      return next();
    }

    // OPT-IN: Check for Idempotency-Key header
    const idempotencyKey = req.headers['idempotency-key'] as string;

    if (!idempotencyKey) {
      // No key provided, skip idempotency check
      return next();
    }

    // Validate key format (should be UUID or similar, 16-255 characters)
    if (idempotencyKey.length < 16 || idempotencyKey.length > 255) {
      return next(new AppError(
        400,
        'Invalid Idempotency-Key header (must be 16-255 characters)',
        'INVALID_IDEMPOTENCY_KEY'
      ));
    }

    const redisKey = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;

    try {
      // Check for cached response
      const cached = await redis.get(redisKey);

      if (cached) {
        const cachedResponse: CachedResponse = JSON.parse(cached);

        logger.info(
          {
            idempotencyKey,
            path: req.path,
            cachedStatus: cachedResponse.status,
          },
          'Returning cached idempotent response'
        );

        // Return cached response with replay header
        return res
          .status(cachedResponse.status)
          .set('X-Idempotent-Replay', 'true')
          .json(cachedResponse.body);
      }

      // Store original send function
      const originalSend = res.json.bind(res);

      // Override res.json to cache response
      res.json = (body: any) => {
        // Cache successful responses only (2xx)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheData: CachedResponse = {
            status: res.statusCode,
            body,
            timestamp: Date.now(),
          };

          // Cache for 24 hours (Stripe's TTL)
          redis.setex(redisKey, DEFAULT_TTL, JSON.stringify(cacheData))
            .catch((err) => {
              logger.error({ err, idempotencyKey }, 'Failed to cache idempotency response');
            });
        }

        return originalSend(body);
      };

      next();
    } catch (error) {
      logger.error({ error, idempotencyKey }, 'Idempotency middleware error');
      // Fail open: don't block request if Redis fails
      next();
    }
  };
}
