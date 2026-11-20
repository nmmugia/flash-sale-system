import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/**
 * Redis client configuration
 * Used for inventory management, idempotency, and metrics
 */
const redisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  enableOfflineQueue: false,
  connectTimeout: 10000,
  commandTimeout: 5000,
  retryStrategy: (times: number) => {
    if (times > 3) {
      return null; // Stop retrying
    }
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  lazyConnect: false,
  keepAlive: 30000,
  noDelay: true,
};

// Main Redis client for operations
export const redis = new Redis(redisOptions);

// Separate Redis client for pub/sub (required by Redis protocol)
export const redisPubSub = new Redis(redisOptions);

// Log connection events
redis.on('connect', () => {
  logger.info('Redis client connected');
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis client error');
});

redisPubSub.on('connect', () => {
  logger.info('Redis pub/sub client connected');
});

redisPubSub.on('error', (err) => {
  logger.error({ err }, 'Redis pub/sub client error');
});

/**
 * Check Redis connectivity
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return false;
  }
}

/**
 * Gracefully close Redis connections
 */
export async function closeRedisConnections(): Promise<void> {
  await redis.quit();
  await redisPubSub.quit();
  logger.info('Redis connections closed');
}
