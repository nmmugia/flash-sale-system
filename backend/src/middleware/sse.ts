import { Request, Response } from 'express';
import { logger } from '../config/logger';

/**
 * Server-Sent Events (SSE) Middleware
 * 
 * Provides real-time order status updates to connected clients.
 * Falls back to short polling for browsers that don't support SSE.
 */

// Store active SSE connections
const activeConnections = new Map<string, Response>();

/**
 * SSE connection handler
 * Establishes long-lived connection for real-time updates
 */
export function establishSSEConnection(req: Request, res: Response) {
  const { reservationId } = req.params;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

  // Send initial connection message
  res.write(`event: connected\ndata: ${JSON.stringify({ reservationId })}\n\n`);

  // Store connection
  activeConnections.set(reservationId, res);

  logger.info({ reservationId }, 'SSE connection established');

  // Send heartbeat every 15 seconds to keep connection alive
  const heartbeatInterval = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (error) {
      // Connection closed
      clearInterval(heartbeatInterval);
      activeConnections.delete(reservationId);
    }
  }, 15000);

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeatInterval);
    activeConnections.delete(reservationId);
    logger.info({ reservationId }, 'SSE connection closed');
  });
}

/**
 * Send SSE event to specific client
 */
export function sendSSEEvent(reservationId: string, event: string, data: any) {
  const connection = activeConnections.get(reservationId);
  
  if (connection) {
    try {
      connection.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      logger.debug({ reservationId, event }, 'SSE event sent');
    } catch (error) {
      logger.error({ error, reservationId }, 'Failed to send SSE event');
      activeConnections.delete(reservationId);
    }
  }
}

/**
 * Broadcast SSE event to all connected clients
 */
export function broadcastSSEEvent(event: string, data: any) {
  activeConnections.forEach((connection, reservationId) => {
    try {
      connection.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      activeConnections.delete(reservationId);
    }
  });
}

/**
 * Get active SSE connections count
 */
export function getActiveConnectionsCount(): number {
  return activeConnections.size;
}
