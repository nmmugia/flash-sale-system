import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../config/logger';
import { circuitBreaker } from '../utils/circuitBreaker';

/**
 * Redis Inventory Service
 * 
 * Implements hot-path inventory gating using Redis + Lua scripts.
 * Provides atomic operations to prevent race conditions and overselling.
 * 
 * Architecture:
 * - Lua script executes atomically on Redis server
 * - Single operation: check user + decrement stock + return remaining
 * - Sub-millisecond latency
 * - No distributed locks needed
 */

// Lua script for atomic inventory check and decrement
// Returns: {success, reservationId, stockRemaining, error}
const ATTEMPT_PURCHASE_SCRIPT = `
local saleId = KEYS[1]
local userId = ARGV[1]
local reservationId = ARGV[2]
local stockKey = 'sale:' .. saleId .. ':stock'
local usersKey = 'sale:' .. saleId .. ':users'

-- Check if user already purchased (one item per user rule)
if redis.call('SISMEMBER', usersKey, userId) == 1 then
    return {0, '', 0, 'ALREADY_PURCHASED'}
end

-- Check if stock is available
local stock = tonumber(redis.call('GET', stockKey))
if not stock or stock <= 0 then
    return {0, '', 0, 'SOLD_OUT'}
end

-- Atomic decrement and record user
local newStock = redis.call('DECR', stockKey)
redis.call('SADD', usersKey, userId)

-- Return success with reservation ID and remaining stock
return {1, reservationId, newStock, ''}
`;

// Lua script to return inventory (for compensation on payment failure)
const RETURN_INVENTORY_SCRIPT = `
local saleId = KEYS[1]
local userId = ARGV[1]
local stockKey = 'sale:' .. saleId .. ':stock'
local usersKey = 'sale:' .. saleId .. ':users'

-- Remove user from purchased set
redis.call('SREM', usersKey, userId)

-- Increment stock back
local newStock = redis.call('INCR', stockKey)

return newStock
`;

export interface PurchaseResult {
  success: boolean;
  reservationId?: string;
  stockRemaining?: number;
  error?: string;
}

export class RedisInventoryService {
  private attemptPurchaseSha: string | null = null;
  private returnInventorySha: string | null = null;

  constructor(private redis: Redis) {}

  /**
   * Initialize Lua scripts (load them into Redis for faster execution)
   */
  async initialize(): Promise<void> {
    try {
      // Test Redis connection first
      await this.redis.ping();
      logger.info('Redis connection verified before script loading');

      // Load scripts and store SHA hashes
      logger.debug('Loading ATTEMPT_PURCHASE_SCRIPT...');
      this.attemptPurchaseSha = (await this.redis.script('LOAD', ATTEMPT_PURCHASE_SCRIPT)) as string;

      logger.debug('Loading RETURN_INVENTORY_SCRIPT...');
      this.returnInventorySha = (await this.redis.script('LOAD', RETURN_INVENTORY_SCRIPT)) as string;

      logger.info(
        {
          attemptPurchaseSha: this.attemptPurchaseSha,
          returnInventorySha: this.returnInventorySha,
        },
        'Lua scripts loaded into Redis'
      );
    } catch (error) {
      logger.error({
        error: error instanceof Error ? {
          message: error.message,
          stack: error.stack,
          name: error.name,
        } : error,
        attemptPurchaseSha: this.attemptPurchaseSha,
        returnInventorySha: this.returnInventorySha,
      }, 'Failed to load Lua scripts');
      throw error;
    }
  }

  /**
   * Initialize a sale in Redis with stock
   */
  async initializeSale(saleId: string, totalStock: number): Promise<void> {
    const stockKey = `sale:${saleId}:stock`;
    const usersKey = `sale:${saleId}:users`;

    await this.redis.multi()
      .set(stockKey, totalStock)
      .del(usersKey)
      .exec();

    logger.info({ saleId, totalStock }, 'Sale initialized in Redis');
  }

  /**
   * Attempt to purchase an item (ATOMIC OPERATION)
   *
   * Returns:
   * - success: true if purchase successful
   * - reservationId: unique ID for this purchase
   * - stockRemaining: remaining stock after purchase
   * - error: error message if failed
   */
  async attemptPurchase(saleId: string, userId: string): Promise<PurchaseResult> {
    try {
      // Ensure scripts are loaded
      if (!this.attemptPurchaseSha) {
        logger.warn('Lua script SHA not found, reinitializing scripts');
        await this.initialize();
      }

      // FAST PATH: Check circuit breaker first (in-memory, <0.1ms)
      if (circuitBreaker.isSoldOut(saleId)) {
        logger.debug({ saleId, userId }, 'Request blocked by circuit breaker');
        return {
          success: false,
          error: 'SOLD_OUT',
        };
      }

      // SLOW PATH: Execute Redis Lua script (1-2ms)
      const reservationId = uuidv4();

      const result = await this.redis.evalsha(
        this.attemptPurchaseSha!,
        1,
        saleId,
        userId,
        reservationId
      ) as [number, string, number, string];

      const [success, resId, stockRemaining, error] = result;

      if (success === 1) {
        // Successful purchase
        logger.info(
          {
            saleId,
            userId,
            reservationId: resId,
            stockRemaining,
          },
          'Purchase successful'
        );

        // ACTIVATE CIRCUIT BREAKER if stock is depleted
        if (stockRemaining === 0) {
          circuitBreaker.setSoldOut(saleId);
          logger.info({ saleId }, 'Circuit breaker activated: stock depleted');
        }

        return {
          success: true,
          reservationId: resId,
          stockRemaining,
        };
      } else {
        // Purchase failed (already purchased or sold out)
        logger.warn(
          {
            saleId,
            userId,
            error,
          },
          'Purchase attempt failed'
        );

        // If sold out, activate circuit breaker
        if (error === 'SOLD_OUT') {
          circuitBreaker.setSoldOut(saleId);
        }

        return {
          success: false,
          error,
        };
      }
    } catch (error) {
      logger.error({ error, saleId, userId }, 'Error during purchase attempt');
      throw error;
    }
  }

  /**
   * Return inventory (compensation for failed payment)
   */
  async returnInventory(saleId: string, userId: string): Promise<number> {
    try {
      const result = await this.redis.evalsha(
        this.returnInventorySha!,
        1,
        saleId,
        userId
      ) as number;

      logger.info(
        {
          saleId,
          userId,
          newStock: result,
        },
        'Inventory returned due to payment failure'
      );

      // Reset circuit breaker since stock is available again
      circuitBreaker.reset(saleId);
      logger.info({ saleId }, 'Circuit breaker reset: inventory available' );

      return result;
    } catch (error) {
      logger.error({ error, saleId, userId }, 'Error returning inventory');
      throw error;
    }
  }

  /**
   * Get current stock for a sale
   */
  async getStock(saleId: string): Promise<number> {
    const stockKey = `sale:${saleId}:stock`;
    const stock = await this.redis.get(stockKey);
    return stock ? parseInt(stock, 10) : 0;
  }

  /**
   * Check if a user has purchased
   */
  async hasUserPurchased(saleId: string, userId: string): Promise<boolean> {
    const usersKey = `sale:${saleId}:users`;
    return (await this.redis.sismember(usersKey, userId)) === 1;
  }

  /**
   * Get sale metrics
   */
  async getSaleMetrics(saleId: string): Promise<{
    stock: number;
    purchasedCount: number;
  }> {
    const stockKey = `sale:${saleId}:stock`;
    const usersKey = `sale:${saleId}:users`;

    const [stock, purchasedCount] = await Promise.all([
      this.redis.get(stockKey),
      this.redis.scard(usersKey),
    ]);

    return {
      stock: stock ? parseInt(stock, 10) : 0,
      purchasedCount,
    };
  }
}
