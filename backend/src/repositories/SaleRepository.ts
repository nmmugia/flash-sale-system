import { Pool } from 'pg';
import { Sale } from '../types';
import { logger } from '../config/logger';

/**
 * Repository for Sale database operations
 * Implements repository pattern for clean separation of concerns
 */
export class SaleRepository {
  constructor(private pool: Pool) {}

  /**
   * Find a sale by ID
   */
  async findById(saleId: string): Promise<Sale | null> {
    try {
      const result = await this.pool.query<Sale>(
        'SELECT * FROM sales WHERE id = $1',
        [saleId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToSale(result.rows[0]);
    } catch (error) {
      logger.error({ error, saleId }, 'Error finding sale by ID');
      throw error;
    }
  }

  /**
   * Find all sales
   */
  async findAll(): Promise<Sale[]> {
    try {
      const result = await this.pool.query<Sale>(
        'SELECT * FROM sales ORDER BY created_at DESC'
      );

      return result.rows.map(row => this.mapToSale(row));
    } catch (error) {
      logger.error({ error }, 'Error finding all sales');
      throw error;
    }
  }

  /**
   * Find active sales (currently ongoing)
   */
  async findActive(): Promise<Sale[]> {
    try {
      const result = await this.pool.query<Sale>(
        `SELECT * FROM sales 
         WHERE start_time <= NOW() 
         AND end_time > NOW()
         ORDER BY start_time ASC`
      );

      return result.rows.map(row => this.mapToSale(row));
    } catch (error) {
      logger.error({ error }, 'Error finding active sales');
      throw error;
    }
  }

  /**
   * Create a new sale
   */
  async create(sale: Omit<Sale, 'createdAt'>): Promise<Sale> {
    try {
      const result = await this.pool.query<Sale>(
        `INSERT INTO sales (id, product_name, total_stock, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [sale.id, sale.productName, sale.totalStock, sale.startTime, sale.endTime]
      );

      return this.mapToSale(result.rows[0]);
    } catch (error) {
      logger.error({ error, sale }, 'Error creating sale');
      throw error;
    }
  }

  /**
   * Update a sale
   */
  async update(saleId: string, updates: Partial<Omit<Sale, 'id' | 'createdAt'>>): Promise<Sale | null> {
    try {
      const fields: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (updates.productName !== undefined) {
        fields.push(`product_name = $${paramCount++}`);
        values.push(updates.productName);
      }
      if (updates.totalStock !== undefined) {
        fields.push(`total_stock = $${paramCount++}`);
        values.push(updates.totalStock);
      }
      if (updates.startTime !== undefined) {
        fields.push(`start_time = $${paramCount++}`);
        values.push(updates.startTime);
      }
      if (updates.endTime !== undefined) {
        fields.push(`end_time = $${paramCount++}`);
        values.push(updates.endTime);
      }

      if (fields.length === 0) {
        return this.findById(saleId);
      }

      values.push(saleId);
      const query = `UPDATE sales SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`;

      const result = await this.pool.query<Sale>(query, values);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapToSale(result.rows[0]);
    } catch (error) {
      logger.error({ error, saleId, updates }, 'Error updating sale');
      throw error;
    }
  }

  /**
   * Delete a sale
   */
  async delete(saleId: string): Promise<boolean> {
    try {
      const result = await this.pool.query(
        'DELETE FROM sales WHERE id = $1',
        [saleId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error({ error, saleId }, 'Error deleting sale');
      throw error;
    }
  }

  /**
   * Map database row to Sale type
   */
  private mapToSale(row: any): Sale {
    return {
      id: row.id,
      productName: row.product_name,
      totalStock: row.total_stock,
      startTime: row.start_time,
      endTime: row.end_time,
      createdAt: row.created_at,
    };
  }
}
