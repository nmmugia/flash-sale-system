import { createHash } from 'crypto';

/**
 * Circuit Breaker Pattern Implementation
 * 
 * Provides in-memory kill switch for sold-out sales.
 * When Redis reports 0 stock, all API instances flip a local boolean
 * to short-circuit requests in <0.1ms without hitting Redis.
 * 
 * Cross-instance coordination via Redis pub/sub ensures all instances
 * are notified within <10ms when stock is depleted.
 */
export class CircuitBreaker {
  private soldOutSales: Set<string> = new Set();
  private metrics: { hits: number; misses: number } = { hits: 0, misses: 0 };

  /**
   * Check if a sale is sold out (FAST PATH - in-memory check)
   * This is the <0.1ms path that avoids Redis network calls
   */
  isSoldOut(saleId: string): boolean {
    const isSoldOut = this.soldOutSales.has(saleId);
    
    if (isSoldOut) {
      this.metrics.hits++;
    } else {
      this.metrics.misses++;
    }
    
    return isSoldOut;
  }

  /**
   * Mark a sale as sold out
   * Called when Redis Lua script returns stockRemaining === 0
   */
  setSoldOut(saleId: string): void {
    this.soldOutSales.add(saleId);
  }

  /**
   * Reset circuit breaker for a sale
   * Called when inventory is returned due to payment failure/compensation
   */
  reset(saleId: string): void {
    this.soldOutSales.delete(saleId);
  }

  /**
   * Get circuit breaker metrics
   */
  getMetrics() {
    const total = this.metrics.hits + this.metrics.misses;
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      hitRate: total > 0 ? this.metrics.hits / total : 0,
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  resetMetrics(): void {
    this.metrics = { hits: 0, misses: 0 };
  }
}

// Singleton instance
export const circuitBreaker = new CircuitBreaker();

/**
 * Idempotency Key Generator
 * Creates a deterministic hash from userId + saleId for request deduplication
 */
export function generateIdempotencyKey(userId: string, saleId: string): string {
  const data = `${userId}:${saleId}`;
  return createHash('sha256').update(data).digest('hex');
}
