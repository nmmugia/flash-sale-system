import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { closeDatabasePool } from './config/database';
import { closeRedisConnections, redis } from './config/redis';
import { RedisInventoryService } from './services/redisInventoryService';
import { PubSubCoordinator } from './services/pubSubCoordinator';
import { SaleRepository } from './repositories';
import { pool } from './config/database';

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
    const pubSubCoordinator = new PubSubCoordinator(redis);
    const saleRepository = new SaleRepository(pool);

    // Load Lua scripts into Redis
    await inventoryService.initialize();

    // Subscribe to pub/sub for circuit breaker coordination
    await pubSubCoordinator.subscribe();

    // Initialize sale in Redis (if it exists in database)
    const sale = await saleRepository.findById(env.SALE_ID);
    if (sale) {
      await inventoryService.initializeSale(sale.id, sale.totalStock);
      logger.info(
        {
          saleId: sale.id,
          totalStock: sale.totalStock,
        },
        'Sale initialized in Redis'
      );
    }

    // Create Express app
    const app = await createApp();

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
