import { QueueEvents } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../config/logger';

/**
 * Order Event Stream Service
 * 
 * Listens to BullMQ job events and streams updates to connected SSE clients.
 */

const QUEUE_NAME = 'order-queue';

export class OrderEventStream {
  private queueEvents: QueueEvents;

  constructor(redis: Redis) {
    this.queueEvents = new QueueEvents(QUEUE_NAME, { connection: redis });
  }

  /**
   * Start listening to job events
   */
  async start(): Promise<void> {
    logger.info('Starting order event stream listener');

    // Listen to job completed events
    this.queueEvents.on('completed', ({ jobId }) => {
      logger.info({ jobId }, 'Order completed event received');
      
      // Note: We'd need to fetch job data from the queue to get reservationId
      // For now, we rely on the worker updating order status in DB
    });

    // Listen to job failed events
    this.queueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.info({ jobId, failedReason }, 'Order failed event received');
    });
  }

  /**
   * Stop listening to events
   */
  async stop(): Promise<void> {
    await this.queueEvents.close();
    logger.info('Order event stream stopped');
  }
}
