import { Pool, PoolConfig } from 'pg';
import { env } from './env';
import { logger } from './logger';

/**
 * PostgreSQL connection pool configuration
 * Connects through PgBouncer for connection pooling
 */
const poolConfig: PoolConfig = {
  host: env.POSTGRES_HOST,
  port: env.POSTGRES_PORT,
  database: env.POSTGRES_DB,
  user: env.POSTGRES_USER,
  password: env.POSTGRES_PASSWORD,

  // Pool configuration
  // PgBouncer handles the actual pooling, so we keep this minimal
  max: 50,
  min: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  query_timeout: 10000,
  // statement_timeout removed - not supported by PgBouncer

  // Application name for monitoring
  application_name: 'flash-sale-api',
};

export const pool = new Pool(poolConfig);

// Log pool errors
pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected database pool error');
});

/**
 * Check database connectivity
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    return false;
  }
}

/**
 * Gracefully close database pool
 */
export async function closeDatabasePool(): Promise<void> {
  await pool.end();
  logger.info('Database pool closed');
}
