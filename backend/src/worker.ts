import { Worker, Job } from 'bullmq';
import { logger } from './config/logger';
import { env } from './config/env';
import { pool } from './config/database';
import { redis } from './config/redis';
import { RedisInventoryService } from './services/redisInventoryService';
import { PubSubCoordinator } from './services/pubSubCoordinator';
import { PaymentService } from './services/paymentService';
import { OrderRepository } from './repositories';
import { OrderJob, OrderStatus } from './types';

/**
 * BullMQ Worker Process
 * 
 * Consumes order jobs from the queue and processes payment.
 * Implements:
 * - Automatic retry with exponential backoff
 * - Compensation (return inventory) on final failure
 * - Circuit breaker reset when inventory is returned
 */

const QUEUE_NAME = 'order-queue';

async function main() {
  logger.info(
    {
      nodeVersion: process.version,
      workerConcurrency: env.WORKER_CONCURRENCY,
    },
    'Starting BullMQ worker'
  );

  // Initialize services
  const inventoryService = new RedisInventoryService(redis);
  const pubSubCoordinator = new PubSubCoordinator(redis);
  const paymentService = new PaymentService();
  const orderRepository = new OrderRepository(pool);

  // Initialize inventory service (load Lua scripts)
  await inventoryService.initialize();

  // Create worker
  const worker = new Worker<OrderJob>(
    QUEUE_NAME,
    async (job: Job<OrderJob>) => {
      const { reservationId, userId, saleId } = job.data;

      logger.info(
        {
          jobId: job.id,
          reservationId,
          userId,
          saleId,
          attemptNumber: job.attemptsMade,
        },
        'Processing order job'
      );

      try {
        // Create order in database with 'processing' status
        await orderRepository.create({
          saleId,
          userId,
          reservationId,
          status: OrderStatus.PROCESSING,
          paymentAttempts: job.attemptsMade,
        });

        // Process payment
        const paymentResult = await paymentService.processPayment(userId);

        if (paymentResult.success) {
          // Payment successful - update order status
          await orderRepository.updateStatusByReservation(
            reservationId,
            OrderStatus.PAID
          );

          logger.info(
            {
              reservationId,
              transactionId: paymentResult.transactionId,
            },
            'Order completed successfully'
          );

          return paymentResult;
        } else {
          // Payment failed
          throw new Error(paymentResult.error || 'Payment failed');
        }
      } catch (error) {
        logger.error(
          {
            error,
            reservationId,
            attemptNumber: job.attemptsMade,
            maxAttempts: job.opts.attempts,
          },
          'Order processing failed'
        );

        // Increment payment attempts
        const order = await orderRepository.findByReservationId(reservationId);
        if (order) {
          await orderRepository.incrementPaymentAttempts(order.id);
        }

        // If this was the last attempt, compensate
        if (job.attemptsMade >= (job.opts.attempts || 3)) {
          logger.warn(
            {
              reservationId,
              attempts: job.attemptsMade,
            },
            'Max retries reached, compensating'
          );

          // Update order status to failed
          await orderRepository.updateStatusByReservation(
            reservationId,
            OrderStatus.FAILED
          );

          // Return inventory
          await inventoryService.returnInventory(saleId, userId);

          // Publish reset event to other instances
          await pubSubCoordinator.publishReset(saleId);
        }

        throw error; // Re-throw to trigger retry
      }
    },
    {
      connection: redis,
      concurrency: env.WORKER_CONCURRENCY,
    }
  );

  // Worker event handlers
  worker.on('completed', (job: Job<OrderJob>) => {
    logger.info(
      {
        jobId: job.id,
        reservationId: job.data.reservationId,
      },
      'Job completed successfully'
    );
  });

  worker.on('failed', (job: Job<OrderJob> | undefined, err: Error) => {
    logger.error(
      {
        jobId: job?.id,
        reservationId: job?.data.reservationId,
        error: err.message,
      },
      'Job failed'
    );
  });

  worker.on('error', (err: Error) => {
    logger.error({ error: err }, 'Worker error');
  });

  logger.info('Worker started and ready to process jobs');

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down worker...');

    await worker.close();
    await pool.end();
    await redis.quit();

    logger.info('Worker shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (error) => {
    logger.fatal({ error }, 'Uncaught exception in worker');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'Unhandled rejection in worker');
    process.exit(1);
  });
}

main().catch((error) => {
  logger.fatal({ error }, 'Failed to start worker');
  process.exit(1);
});
