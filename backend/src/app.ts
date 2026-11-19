import express, { Request, Response } from 'express';
import { requestLogger, addRequestId } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import { checkDatabaseHealth } from './config/database';
import { checkRedisHealth } from './config/redis';
import { logger } from './config/logger';

/**
 * Create and configure Express application
 */
export function createApp() {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging and tracing
  app.use(addRequestId);
  app.use(requestLogger);

  // Health check endpoint (liveness probe)
  app.get('/health', async (req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness check endpoint
  app.get('/ready', async (req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth();
    const redisHealth = await checkRedisHealth();

    const isReady = dbHealth && redisHealth;

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not ready',
      checks: {
        database: dbHealth ? 'healthy' : 'unhealthy',
        redis: redisHealth ? 'healthy' : 'unhealthy',
      },
      timestamp: new Date().toISOString(),
    });
  });

  // API routes will be added here
  // app.use('/api', routes);

  // 404 handler
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: 'Not found',
      code: 'NOT_FOUND',
      path: req.path,
    });
  });

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
