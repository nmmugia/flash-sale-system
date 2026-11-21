import express, { Request, Response } from 'express';
import { requestLogger, addRequestId } from './middleware/requestLogger';
import { errorHandler, asyncHandler } from './middleware/errorHandler';
import { idempotencyMiddleware } from './middleware/idempotency';
import { checkDatabaseHealth } from './config/database';
import { checkRedisHealth, redis } from './config/redis';
import { logger } from './config/logger';
import { RedisInventoryService } from './services/redisInventoryService';
import { PubSubCoordinator } from './services/pubSubCoordinator';
import { QueueService } from './services/queueService';
import { SaleRepository, OrderRepository } from './repositories';
import { pool } from './config/database';

// Initialize services
const inventoryService = new RedisInventoryService(redis);
const pubSubCoordinator = new PubSubCoordinator(redis);
const queueService = new QueueService(redis);
const saleRepository = new SaleRepository(pool);
const orderRepository = new OrderRepository(pool);

/**
 * Create and configure Express application
 */
export async function createApp(): Promise<express.Application> {
  const app = express();

  // Body parsing middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use(addRequestId);
  app.use(requestLogger);

  // Idempotency middleware (opt-in via Idempotency-Key header)
  app.use(idempotencyMiddleware(redis));

  // Health check endpoint
  app.get('/health', async (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Readiness check endpoint
  app.get('/ready', async (_req: Request, res: Response) => {
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

  // Admin routes for initialization
  app.post('/api/admin/initialize-sale', asyncHandler(async (req: Request, res: Response) => {
    const { saleId } = req.body;

    if (!saleId) {
      return res.status(400).json({
        success: false,
        error: 'saleId is required',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // Get sale from database
      const sale = await saleRepository.findById(saleId);

      if (!sale) {
        return res.status(404).json({
          success: false,
          error: 'Sale not found',
          code: 'NOT_FOUND',
        });
      }

      // Initialize in Redis
      await inventoryService.initializeSale(saleId, sale.totalStock);

      // Cache sale metadata
      await redis.setex(`sale:${saleId}`, 3600, JSON.stringify({
        id: sale.id,
        productName: sale.productName,
        totalStock: sale.totalStock,
        startTime: sale.startTime,
        endTime: sale.endTime,
      }));

      return res.json({
        success: true,
        message: 'Sale initialized and cached in Redis',
        saleId,
        totalStock: sale.totalStock,
      });
    } catch (error) {
      logger.error({ error, saleId }, 'Failed to initialize sale');
      throw error;
    }
  }));

  // API Routes
  app.use('/api', createRoutes(
    inventoryService,
    queueService,
    saleRepository,
    orderRepository,
    pubSubCoordinator
  ));

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

/**
 * Create API routes
 */
function createRoutes(
  inventoryService: RedisInventoryService,
  queueService: QueueService,
  saleRepository: SaleRepository,
  orderRepository: OrderRepository,
  pubSubCoordinator: PubSubCoordinator
) {
  const router = express.Router();

  // POST /api/purchases - Attempt to purchase an item
  router.post('/purchases', asyncHandler(async (req: Request, res: Response) => {
    const { userId, saleId } = req.body;

    // Validate input
    if (!userId || !saleId) {
      return res.status(400).json({
        success: false,
        error: 'userId and saleId are required',
        code: 'VALIDATION_ERROR',
      });
    }

    try {
      // Get sale from cache or database
      const cachedSale = await redis.get(`sale:${saleId}`);
      let sale;

      if (cachedSale) {
        sale = JSON.parse(cachedSale);
      } else {
        sale = await saleRepository.findById(saleId);
        if (!sale) {
          return res.status(404).json({
            success: false,
            error: 'Sale not found',
            code: 'NOT_FOUND',
          });
        }
        await redis.setex(`sale:${saleId}`, 3600, JSON.stringify(sale));
      }

      const now = Date.now();
      const startTime = new Date(sale.startTime).getTime();
      const endTime = new Date(sale.endTime).getTime();

      if (now < startTime) {
        return res.status(400).json({
          success: false,
          error: 'Sale has not started yet',
          code: 'SALE_NOT_ACTIVE',
        });
      }

      if (now > endTime) {
        return res.status(400).json({
          success: false,
          error: 'Sale has ended',
          code: 'SALE_ENDED',
        });
      }

      // Attempt purchase (atomic Redis operation)
      const result = await inventoryService.attemptPurchase(saleId, userId);

      if (!result.success) {
        // Map error codes to HTTP status
        const statusCode = result.error === 'ALREADY_PURCHASED' ? 409 : 409;

        return res.status(statusCode).json({
          success: false,
          error: result.error,
          message: result.error === 'ALREADY_PURCHASED'
            ? 'You have already purchased this item'
            : 'Item is sold out',
          code: result.error,
        });
      }

      // Successful reservation - publish soldout if needed
      if (result.stockRemaining === 0) {
        await pubSubCoordinator.publishSoldOut(saleId);
      }

      // Enqueue job for async payment processing
      await queueService.addOrderJob({
        reservationId: result.reservationId!,
        userId,
        saleId,
        timestamp: Date.now(),
      });

      // Return 202 Accepted
      return res.status(202).json({
        success: true,
        reservationId: result.reservationId,
        message: 'Purchase reserved, processing payment',
        stockRemaining: result.stockRemaining,
      });
    } catch (error) {
      logger.error({ error, userId, saleId }, 'Purchase endpoint error');
      throw error;
    }
  }));

  // GET /api/orders/:reservationId - Get order status
  router.get('/orders/:reservationId', asyncHandler(async (req: Request, res: Response) => {
    const { reservationId } = req.params;

    try {
      const order = await orderRepository.findByReservationId(reservationId);

      if (!order) {
        return res.status(404).json({
          success: false,
          error: 'Order not found',
          code: 'NOT_FOUND',
        });
      }

      return res.json({
        success: true,
        order: {
          id: order.id,
          userId: order.userId,
          reservationId: order.reservationId,
          status: order.status,
          paymentAttempts: order.paymentAttempts,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
      });
    } catch (error) {
      logger.error({ error, reservationId }, 'Get order status error');
      throw error;
    }
  }));

  // GET /api/sales/:saleId/status - Get sale status
  router.get('/sales/:saleId/status', asyncHandler(async (req: Request, res: Response) => {
    const { saleId } = req.params;

    try {
      const [sale, metrics] = await Promise.all([
        saleRepository.findById(saleId),
        inventoryService.getSaleMetrics(saleId),
      ]);

      if (!sale) {
        return res.status(404).json({
          success: false,
          error: 'Sale not found',
          code: 'NOT_FOUND',
        });
      }

      const now = new Date();
      let status: 'upcoming' | 'active' | 'ended' | 'sold_out';

      if (now < sale.startTime) {
        status = 'upcoming';
      } else if (now > sale.endTime) {
        status = 'ended';
      } else if (metrics.stock === 0) {
        status = 'sold_out';
      } else {
        status = 'active';
      }

      return res.json({
        success: true,
        sale: {
          saleId: sale.id,
          productName: sale.productName,
          stockRemaining: metrics.stock,
          totalStock: sale.totalStock,
          purchasedCount: metrics.purchasedCount,
          status,
          isSoldOut: metrics.stock === 0,
          startTime: sale.startTime,
          endTime: sale.endTime,
        },
      });
    } catch (error) {
      logger.error({ error, saleId }, 'Get sale status error');
      throw error;
    }
  }));

  // GET /api/metrics - Get system metrics
  router.get('/metrics', asyncHandler(async (_req: Request, res: Response) => {
    try {
      const queueMetrics = await queueService.getQueueMetrics();

      return res.json({
        success: true,
        metrics: {
          queueDepth: queueMetrics.total,
          queueWaiting: queueMetrics.waiting,
          queueActive: queueMetrics.active,
          queueCompleted: queueMetrics.completed,
          queueFailed: queueMetrics.failed,
        },
      });
    } catch (error) {
      logger.error({ error }, 'Get metrics error');
      throw error;
    }
  }));

  return router;
}
