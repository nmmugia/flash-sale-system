import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../config/logger';
import { OrderJob } from '../types';

/**
 * BullMQ Queue Service
 * 
 * Provides Redis-based job queue for async order processing.
 * Implements durable, fault-tolerant job processing with:
 * - Automatic retry with exponential backoff
 * - Job persistence (survives crashes)
 * - Horizontal scaling of workers
 * - Job events for real-time status updates
 */

export const QUEUE_NAME = 'order-queue';

export class QueueService {
  private queue: Queue;

  constructor(redis: Redis) {
    
    // Create queue with Redis connection
    this.queue = new Queue(QUEUE_NAME, {
      connection: redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000, // Start with 1s, double each retry
        },
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000, // Or max 1000 jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
        },
      },
    });

    logger.info({ queueName: QUEUE_NAME }, 'BullMQ queue created');
  }

  /**
   * Add a job to the queue
   */
  async addOrderJob(job: OrderJob): Promise<string> {
    try {
      const queueJob = await this.queue.add('process-order', job, {
        jobId: job.reservationId, // Use reservation ID as job ID for idempotency
      });

      logger.info(
        {
          reservationId: job.reservationId,
          userId: job.userId,
          saleId: job.saleId,
          jobId: queueJob.id,
        },
        'Order job added to queue'
      );

      return queueJob.id!;
    } catch (error) {
      logger.error({ error, job }, 'Failed to add job to queue');
      throw error;
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics() {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);

      return {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + delayed,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get queue metrics');
      throw error;
    }
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string) {
    return await this.queue.getJob(jobId);
  }

  /**
   * Close queue connection
   */
  async close(): Promise<void> {
    await this.queue.close();
    logger.info('BullMQ queue closed');
  }
}
