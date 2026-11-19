import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { generateIdempotencyKey } from '../utils/circuitBreaker';
import { logger } from '../config/logger';
import { AppError } from './errorHandler';

/**
 * Idempotency Middleware
 * 
 * Ensures duplicate requests (same userId + saleId) return the same response
 * without re-processing. Handles retry storms gracefully.
 * 
 * Flow:
 * 1. Generate idempotency key from userId + saleId
 * 2. Check Redis for existing key
 * 3. If exists, return cached response
 * 4. If not, continue to handler and cache response
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
    // Only apply to POST /api/purchases
    if (req.method !== 'POST' || !req.path.includes('/purchases')) {
      return next();
    }

    const { userId, saleId } = req.body;

    if (!userId || !saleId) {
      return next(new AppError(400, 'userId and saleId are required', 'VALIDATION_ERROR'));
    }

    try {
      // Generate idempotency key
      const idempotencyKey = generateIdempotencyKey(userId, saleId);
      const redisKey = `${IDEMPOTENCY_PREFIX}${idempotencyKey}`;

      // Check for cached response
      const cached = await redis.get(redisKey);

      if (cached) {
        const cachedResponse: CachedResponse = JSON.parse(cached);
        
        logger.info(
          {
            userId,
            saleId,
            idempotencyKey,
          },
          'Idempotent request: returning cached response'
        );

        // Return cached response
        return res.status(cachedResponse.status).json(cachedResponse.body);
      }

      // Store original send function
      const originalSend = res.json.bind(res);

      // Override res.json to cache response
      res.json = (body: any) => {
        // Cache successful responses only
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const cacheData: CachedResponse = {
            status: res.statusCode,
            body,
            timestamp: Date.now(),
          };

          redis.setex(redisKey, DEFAULT_TTL, JSON.stringify(cacheData))
            .catch((err) => {
              logger.error({ err, idempotencyKey }, 'Failed to cache idempotency response');
            });
        }

        return originalSend(body);
      };

      next();
    } catch (error) {
      logger.error({ error, userId, saleId }, 'Idempotency middleware error');
      next(error);
    }
  };
}
