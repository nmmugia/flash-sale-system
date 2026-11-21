import Redis from 'ioredis';
import { logger } from '../config/logger';
import { circuitBreaker } from '../utils/circuitBreaker';

/**
 * Pub/Sub Coordinator for Circuit Breaker
 * 
 * Manages cross-instance communication via Redis pub/sub.
 * When one API instance detects stock=0, it broadcasts to all other instances
 * so they can activate their local circuit breakers (<10ms propagation).
 */

export const SOLDOUT_CHANNEL_PREFIX = 'sale:soldout:';
export const RESET_CHANNEL_PREFIX = 'sale:reset:';

export class PubSubCoordinator {
  private subscriber: Redis;

  constructor(redis: Redis) {
    // Create a separate subscriber connection from the main Redis instance
    this.subscriber = redis.duplicate();
  }

  /**
   * Subscribe to sold-out and reset events
   */
  async subscribe(): Promise<void> {
    try {
      // Subscribe to soldout events
      await this.subscriber.psubscribe(`${SOLDOUT_CHANNEL_PREFIX}*`);
      
      // Subscribe to reset events
      await this.subscriber.psubscribe(`${RESET_CHANNEL_PREFIX}*`);

      logger.info('Subscribed to Redis pub/sub channels for circuit breaker sync');

      // Handle incoming messages
      this.subscriber.on('pmessage', (pattern, channel, message) => {
        this.handleMessage(pattern, channel, message);
      });

      // Handle connection errors
      this.subscriber.on('error', (err) => {
        logger.error({ err }, 'Redis pub/sub connection error');
      });
    } catch (error) {
      logger.error({ error }, 'Failed to subscribe to Redis pub/sub');
      throw error;
    }
  }

  /**
   * Handle incoming pub/sub messages
   */
  private handleMessage(_pattern: string, channel: string, message: string): void {
    try {
      // Extract saleId from channel
      const saleId = this.extractSaleId(channel);
      
      if (!saleId) {
        logger.warn({ channel }, 'Invalid channel format');
        return;
      }

      // Handle soldout event
      if (channel.startsWith(SOLDOUT_CHANNEL_PREFIX)) {
        circuitBreaker.setSoldOut(saleId);
        logger.info(
          {
            saleId,
            channel,
            timestamp: message,
          },
          'Circuit breaker activated via pub/sub'
        );
      }

      // Handle reset event
      if (channel.startsWith(RESET_CHANNEL_PREFIX)) {
        circuitBreaker.reset(saleId);
        logger.info(
          {
            saleId,
            channel,
          },
          'Circuit breaker reset via pub/sub'
        );
      }
    } catch (error) {
      logger.error({ error, channel, message }, 'Error handling pub/sub message');
    }
  }

  /**
   * Publish soldout event to other instances
   */
  async publishSoldOut(saleId: string): Promise<void> {
    const channel = `${SOLDOUT_CHANNEL_PREFIX}${saleId}`;
    const message = Date.now().toString();
    
    await this.subscriber.publish(channel, message);
    
    logger.info({ saleId, channel }, 'Published soldout event');
  }

  /**
   * Publish reset event to other instances
   */
  async publishReset(saleId: string): Promise<void> {
    const channel = `${RESET_CHANNEL_PREFIX}${saleId}`;
    const message = Date.now().toString();
    
    await this.subscriber.publish(channel, message);
    
    logger.info({ saleId, channel }, 'Published reset event');
  }

  /**
   * Extract saleId from channel name
   */
  private extractSaleId(channel: string): string | null {
    const parts = channel.split(':');
    if (parts.length >= 3) {
      return parts[2];
    }
    return null;
  }

  /**
   * Unsubscribe from all channels
   */
  async unsubscribe(): Promise<void> {
    await this.subscriber.punsubscribe();
    logger.info('Unsubscribed from Redis pub/sub channels');
  }
}
