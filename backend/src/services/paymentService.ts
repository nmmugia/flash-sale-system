import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { PaymentResult } from '../types';
import { env } from '../config/env';

/**
 * Mock Payment Service
 * 
 * Simulates an external payment provider with:
 * - Configurable delay (100-500ms default)
 * - Configurable failure rate (5% default)
 * 
 * In production, this would integrate with Stripe, PayPal, etc.
 */

export class PaymentService {
  private minDelay: number;
  private maxDelay: number;
  private failureRate: number;

  constructor() {
    this.minDelay = env.PAYMENT_MIN_DELAY_MS || 100;
    this.maxDelay = env.PAYMENT_MAX_DELAY_MS || 500;
    this.failureRate = env.PAYMENT_FAILURE_RATE || 0.05;
  }

  /**
   * Process a payment
   * 
   * Returns:
   * - success: true if payment successful
   * - transactionId: unique ID for successful payment
   * - error: error message if failed
   */
  async processPayment(userId: string, amount: number = 99.99): Promise<PaymentResult> {
    // Simulate network delay
    const delay = this.randomDelay();
    await this.sleep(delay);

    // Simulate random failures
    if (Math.random() < this.failureRate) {
      const error = 'Payment declined by provider';
      
      logger.warn(
        {
          userId,
          amount,
          delay,
          failureRate: this.failureRate,
        },
        'Mock payment failed'
      );

      return {
        success: false,
        error,
      };
    }

    // Successful payment
    const transactionId = uuidv4();

    logger.info(
      {
        userId,
        amount,
        transactionId,
        delay,
      },
      'Mock payment successful'
    );

    return {
      success: true,
      transactionId,
    };
  }

  /**
   * Generate random delay between min and max
   */
  private randomDelay(): number {
    return Math.floor(Math.random() * (this.maxDelay - this.minDelay + 1)) + this.minDelay;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
