import { Pool } from 'pg';
import { Order, OrderStatus } from '../types';
import { logger } from '../config/logger';

/**
 * Repository for Order database operations
 */
export class OrderRepository {
  constructor(private pool: Pool) {}

  /**
   * Find an order by ID
   */
  async findById(orderId: string): Promise<Order | null> {
    try {
      const result = await this.pool.query<Order>(
        'SELECT * FROM orders WHERE id = $1',
        [orderId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, orderId }, 'Error finding order by ID');
      throw error;
    }
  }

  /**
   * Find an order by reservation ID
   */
  async findByReservationId(reservationId: string): Promise<Order | null> {
    try {
      const result = await this.pool.query<Order>(
        'SELECT * FROM orders WHERE reservation_id = $1',
        [reservationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, reservationId }, 'Error finding order by reservation ID');
      throw error;
    }
  }

  /**
   * Find orders by user ID and sale ID
   */
  async findByUserAndSale(userId: string, saleId: string): Promise<Order[]> {
    try {
      const result = await this.pool.query<Order>(
        'SELECT * FROM orders WHERE user_id = $1 AND sale_id = $2 ORDER BY created_at DESC',
        [userId, saleId]
      );

      return result.rows.map(row => this.mapToOrder(row));
    } catch (error) {
      logger.error({ error, userId, saleId }, 'Error finding orders by user and sale');
      throw error;
    }
  }

  /**
   * Find all orders for a sale
   */
  async findBySaleId(saleId: string): Promise<Order[]> {
    try {
      const result = await this.pool.query<Order>(
        'SELECT * FROM orders WHERE sale_id = $1 ORDER BY created_at DESC',
        [saleId]
      );

      return result.rows.map(row => this.mapToOrder(row));
    } catch (error) {
      logger.error({ error, saleId }, 'Error finding orders by sale ID');
      throw error;
    }
  }

  /**
   * Create a new order
   */
  async create(order: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>): Promise<Order> {
    try {
      const result = await this.pool.query<Order>(
        `INSERT INTO orders (sale_id, user_id, reservation_id, status, payment_attempts)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [order.saleId, order.userId, order.reservationId, order.status, order.paymentAttempts || 0]
      );

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, order }, 'Error creating order');
      throw error;
    }
  }

  /**
   * Update order status
   */
  async updateStatus(orderId: string, status: OrderStatus): Promise<Order | null> {
    try {
      const result = await this.pool.query<Order>(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, orderId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, orderId, status }, 'Error updating order status');
      throw error;
    }
  }

  /**
   * Update order status by reservation ID
   */
  async updateStatusByReservation(reservationId: string, status: OrderStatus): Promise<Order | null> {
    try {
      const result = await this.pool.query<Order>(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE reservation_id = $2 RETURNING *',
        [status, reservationId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, reservationId, status }, 'Error updating order status by reservation');
      throw error;
    }
  }

  /**
   * Increment payment attempts
   */
  async incrementPaymentAttempts(orderId: string): Promise<Order | null> {
    try {
      const result = await this.pool.query<Order>(
        `UPDATE orders 
         SET payment_attempts = payment_attempts + 1, updated_at = NOW() 
         WHERE id = $1 
         RETURNING *`,
        [orderId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToOrder(result.rows[0]);
    } catch (error) {
      logger.error({ error, orderId }, 'Error incrementing payment attempts');
      throw error;
    }
  }

  /**
   * Count orders by status for a sale
   */
  async countByStatus(saleId: string, status: OrderStatus): Promise<number> {
    try {
      const result = await this.pool.query(
        'SELECT COUNT(*) as count FROM orders WHERE sale_id = $1 AND status = $2',
        [saleId, status]
      );

      return parseInt(result.rows[0].count, 10);
    } catch (error) {
      logger.error({ error, saleId, status }, 'Error counting orders by status');
      throw error;
    }
  }

  /**
   * Delete an order
   */
  async delete(orderId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM orders WHERE id = $1',
        [orderId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error({ error, orderId }, 'Error deleting order');
      throw error;
    }
  }

  /**
   * Map database row to Order type
   */
  private mapToOrder(row: any): Order {
    return {
      id: row.id,
      saleId: row.sale_id,
      userId: row.user_id,
      reservationId: row.reservation_id,
      status: row.status as OrderStatus,
      paymentAttempts: row.payment_attempts,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
