/**
 * Type definitions for Flash Sale System
 */

export interface Sale {
  id: string;
  productName: string;
  totalStock: number;
  startTime: Date;
  endTime: Date;
  createdAt: Date;
}

export interface Order {
  id: string;
  saleId: string;
  userId: string;
  reservationId: string;
  status: OrderStatus;
  paymentAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

export enum OrderStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PAID = 'paid',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface PurchaseRequest {
  userId: string;
  saleId: string;
}

export interface PurchaseResponse {
  success: boolean;
  reservationId?: string;
  message: string;
  stockRemaining?: number;
}

export interface SaleStatus {
  saleId: string;
  productName: string;
  stockRemaining: number;
  totalStock: number;
  status: 'upcoming' | 'active' | 'ended' | 'sold_out';
  isSoldOut: boolean;
  startTime: string;
  endTime: string;
}

export interface Metrics {
  requests: number;
  purchases: number;
  circuitBreakerHits: number;
  circuitBreakerHitRate: number;
  queueDepth: number;
  queueWaiting: number;
  queueActive: number;
  queueCompleted: number;
  queueFailed: number;
}

export interface OrderJob {
  reservationId: string;
  userId: string;
  saleId: string;
  timestamp: number;
}

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}
