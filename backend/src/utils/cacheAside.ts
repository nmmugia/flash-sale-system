import Redis from 'ioredis';
import { logger } from '../config/logger';

/**
 * Cache-aside pattern with stampede prevention
 * Based on Shopify's flash sale infrastructure
 *
 * Pattern:
 * 1. Try cache first (fast path)
 * 2. On miss, acquire lock to prevent stampede
 * 3. Double-check cache (another request may have populated it)
 * 4. Fetch from source
 * 5. Cache with TTL + jitter to prevent synchronized expiry
 * 6. Release lock
 */

interface CacheAsideOptions {
  ttl: number;              // Cache TTL in seconds
  lockTimeout?: number;     // Lock timeout in seconds (default: 10)
  retryDelay?: number;      // Retry delay in ms when lock not acquired (default: 100)
  enableJitter?: boolean;   // Add jitter to TTL to prevent thundering herd (default: true)
  jitterPercent?: number;   // Jitter percentage (default: 10%)
}

/**
 * Generic cache-aside helper with stampede protection
 */
export async function getCached<T>(
  redis: Redis,
  cacheKey: string,
  fetchFn: () => Promise<T | null>,
  options: CacheAsideOptions
): Promise<T | null> {
  const {
    ttl,
    lockTimeout = 10,
    retryDelay = 100,
    enableJitter = true,
    jitterPercent = 10,
  } = options;

  const lockKey = `lock:${cacheKey}`;

  try {
    // 1. Try cache first (fast path)
    const cached = await redis.get(cacheKey);
    if (cached) {
      // Handle null values (cached negative results)
      if (cached === 'null') {
        return null;
      }
      return JSON.parse(cached);
    }

    // 2. Acquire lock to prevent stampede (SET NX EX)
    const lockAcquired = await redis.set(
      lockKey,
      '1',
      'EX',  // Expire
      lockTimeout,
      'NX'   // Only set if not exists
    );

    // 3. If lock not acquired, another request is fetching
    if (!lockAcquired) {
      logger.debug({ cacheKey }, 'Lock not acquired, waiting for other request');

      // Wait briefly and retry cache
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      const retryCache = await redis.get(cacheKey);

      if (retryCache) {
        if (retryCache === 'null') {
          return null;
        }
        return JSON.parse(retryCache);
      }

      // Still not cached, fall through to fetch
      // (lock holder may have failed or timed out)
    }

    try {
      // 4. Fetch from source
      const data = await fetchFn();

      // 5. Cache result with TTL + jitter
      let finalTtl = ttl;
      if (enableJitter) {
        const jitter = Math.floor(Math.random() * ttl * (jitterPercent / 100));
        finalTtl = ttl + jitter;
      }

      if (data === null) {
        // Cache negative result briefly (prevent DB hammering on non-existent keys)
        await redis.setex(cacheKey, Math.min(60, finalTtl), 'null');
      } else {
        await redis.setex(cacheKey, finalTtl, JSON.stringify(data));
      }

      logger.debug({ cacheKey, ttl: finalTtl }, 'Cached result');

      return data;
    } finally {
      // 6. Always release lock
      if (lockAcquired) {
        await redis.del(lockKey).catch(err => {
          logger.warn({ err, lockKey }, 'Failed to release cache lock');
        });
      }
    }
  } catch (error) {
    logger.error({ error, cacheKey }, 'Cache-aside error, falling back to source');
    // On cache failure, fetch directly from source (fail-open)
    return fetchFn();
  }
}

/**
 * Specialized helper for sale caching
 */
export interface Sale {
  id: string;
  productName: string;
  totalStock: number;
  startTime: Date;
  endTime: Date;
}

export async function getSaleWithCache(
  redis: Redis,
  saleId: string,
  fetchFromDb: (saleId: string) => Promise<Sale | null>
): Promise<Sale | null> {
  const cacheKey = `sale:${saleId}`;

  return getCached<Sale>(
    redis,
    cacheKey,
    () => fetchFromDb(saleId),
    {
      ttl: 3600,        // 1 hour base TTL
      lockTimeout: 10,   // 10 second lock timeout
      retryDelay: 100,   // 100ms retry delay
      enableJitter: true, // Prevent synchronized expiry
      jitterPercent: 10,  // ±10% jitter (54-66 minutes actual TTL)
    }
  );
}
