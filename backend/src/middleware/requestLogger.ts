import { Request, Response, NextFunction } from 'express';
import pinoHttp from 'pino-http';
import { logger } from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request logging middleware with request ID tracing
 * Adds requestId to all logs for distributed tracing
 */
export const requestLogger = pinoHttp({
  logger,
  
  // Generate unique request ID
  genReqId: (req) => req.headers['x-request-id'] as string || uuidv4(),
  
  // Custom serializers
  serializers: {
    req: (req) => ({
      id: req.id,
      method: req.method,
      url: req.url,
      headers: {
        host: req.headers.host,
        userAgent: req.headers['user-agent'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
  
  // Custom log message
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  
  // Don't log health checks
  autoLogging: {
    ignore: (req) => req.url === '/health',
  },
});

/**
 * Add request ID to response headers
 */
export function addRequestId(req: Request, res: Response, next: NextFunction) {
  const requestId = (req as any).id || uuidv4();
  res.setHeader('X-Request-ID', requestId);
  next();
}
