import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { sendSSEEvent } from '../middleware/sse';
import { OrderStatus } from '../types';

/**
 * Order Event Stream Service
 * 
 * Listens to BullMQ job events and streams updates to connected SSE clients.
 */

const QUEUE_NAME = 'order-queue';

export class OrderEventStream {
  private queue: Queue;

  constructor(redis: Redis) {
    this.queue = new Queue(QUEUE_NAME, { connection: redis });
  }

  /**
   * Start listening to job events
   */
  async start(): Promise<void> {
    logger.info('Starting order event stream listener');

    // Listen to job completed events
    this.queue.on('completed', (job) => {
      const { reservationId, userId, saleId } = job.data;
      
      sendSSEEvent(reservationId, 'status', {
        status: OrderStatus.PAID,
        message: 'Payment successful',
        timestamp: new Date().toISOString(),
      });

      logger.info({ reservationId }, 'Order completed event sent');
    });

    // Listen to job failed events
    this.queue.on('failed', (job, err) => {
      if (!job) return;
      
      const { reservationId } = job.data;
      
      sendSSEEvent(reservationId, 'status', {
        status: OrderStatus.FAILED,
        message: 'Payment failed',
        error: err.message,
        timestamp: new Date().toISOString(),
      });

      logger.info({ reservationId }, 'Order failed event sent');
    });

    // Listen to job progress updates
    this.queue.on('progress', (job, progress) => {
      if (!job) return;
      
      const { reservationId } = job.data;
      
      sendSSEEvent(reservationId, 'progress', {
        progress,
        message: 'Processing payment',
        timestamp: new Date().toISOString(),
      });
    });
  }

  /**
   * Stop listening to events
   */
  async stop(): Promise<void> {
    await this.queue.close();
    logger.info('Order event stream stopped');
  }
}
