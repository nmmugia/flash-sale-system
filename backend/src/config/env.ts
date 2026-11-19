import { z } from 'zod';

/**
 * Environment configuration schema with validation
 * Uses Zod for runtime type checking and validation
 */
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  
  // API configuration
  API_PORT: z.string().transform(Number).default('3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  
  // Database configuration
  POSTGRES_HOST: z.string().default('localhost'),
  POSTGRES_PORT: z.string().transform(Number).default('5432'),
  POSTGRES_DB: z.string().default('flashsale'),
  POSTGRES_USER: z.string().default('flashsale_user'),
  POSTGRES_PASSWORD: z.string().default('flashsale_password'),
  
  // Redis configuration
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.string().transform(Number).default('6379'),
  REDIS_PASSWORD: z.string().optional(),
  
  // Flash sale configuration
  SALE_ID: z.string().uuid(),
  
  // Load shedding configuration
  MAX_EVENT_LOOP_LAG_MS: z.string().transform(Number).default('100'),
  MAX_MEMORY_USAGE_PERCENT: z.string().transform(Number).default('80'),
  
  // Worker configuration (optional, only for worker process)
  WORKER_CONCURRENCY: z.string().transform(Number).optional().default('10'),
  
  // Payment service configuration (optional, only for worker process)
  PAYMENT_MIN_DELAY_MS: z.string().transform(Number).optional().default('100'),
  PAYMENT_MAX_DELAY_MS: z.string().transform(Number).optional().default('500'),
  PAYMENT_FAILURE_RATE: z.string().transform(Number).optional().default('0.05'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate and parse environment variables
 * Throws error if validation fails
 */
export function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
      throw new Error(
        `Environment validation failed:\n${missingVars.join('\n')}`
      );
    }
    throw error;
  }
}

// Export validated environment configuration
export const env = validateEnv();
