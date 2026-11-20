import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeDatabasePool } from './config/database';
import { closeRedisConnections, redis, redisPubSub } from './config/redis';
import { RedisInventoryService } from './services/redisInventoryService';
import { PubSubCoordinator } from './services/pubSubCoordinator';

/**
 * Main application entry point
 */
async function main() {
  try {
    logger.info(
      {
        env: env.NODE_ENV,
        nodeVersion: process.version,
      },
      'Starting Flash Sale API'
    );

    // Initialize services
    const inventoryService = new RedisInventoryService(redis);
    const pubSubCoordinator = new PubSubCoordinator(redisPubSub);

    // Load Lua scripts into Redis
    await inventoryService.initialize();

    // Subscribe to pub/sub for circuit breaker coordination
    await pubSubCoordinator.subscribe();

    logger.info('Redis services initialized successfully');

    // Create Express app
    const app = await createApp();

    // Auto-initialize sale in Redis on startup
    try {
      const saleId = process.env.SALE_ID || '550e8400-e29b-41d4-a716-446655440000';
      const totalStock = parseInt(process.env.SALE_TOTAL_STOCK || '100', 10);
      await inventoryService.initializeSale(saleId, totalStock);
      logger.info({ saleId, totalStock }, 'Sale auto-initialized in Redis on startup');
    } catch (error) {
      logger.warn({ error }, 'Failed to auto-initialize sale - you can manually call POST /api/admin/initialize-sale');
    }

    // Start server
    const server = app.listen(env.API_PORT, () => {
      logger.info(
        {
          port: env.API_PORT,
          env: env.NODE_ENV,
          nodeVersion: process.version,
          circuitBreakerEnabled: true,
        },
        'Flash Sale API server started'
      );
    });

    // Graceful shutdown handler
    const shutdown = async (signal: string) => {
      logger.info({ signal }, 'Received shutdown signal, closing server...');

      server.close(async () => {
        logger.info('HTTP server closed');

        try {
          // Close database connections
          await closeDatabasePool();

          // Close Redis connections
          await closeRedisConnections();

          logger.info('All connections closed, exiting');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during shutdown');
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled rejection');
      process.exit(1);
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Start the application
main();
