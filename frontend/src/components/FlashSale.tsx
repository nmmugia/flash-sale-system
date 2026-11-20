import { useState, useEffect } from 'react';

interface SaleStatus {
  saleId: string;
  productName: string;
  stockRemaining: number;
  totalStock: number;
  purchasedCount: number;
  status: 'upcoming' | 'active' | 'ended' | 'sold_out';
  isSoldOut: boolean;
  startTime: string;
  endTime: string;
}

interface Metrics {
  requests: number;
  purchases: number;
  circuitBreakerHits: number;
  circuitBreakerHitRate: number;
  queueDepth: number;
  queueWaiting: number;
  queueActive: number;
}

export default function FlashSale() {
  const [userId, setUserId] = useState('');
  const [saleStatus, setSaleStatus] = useState<SaleStatus | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  const SALE_ID = import.meta.env.VITE_SALE_ID || '550e8400-e29b-41d4-a716-446655440000';

  // Fetch sale status
  const fetchSaleStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/sales/${SALE_ID}/status`);
      const data = await response.json();
      if (data.success) {
        setSaleStatus(data.sale);
      }
    } catch (err) {
      console.error('Failed to fetch sale status:', err);
    }
  };

  // Fetch metrics
  const fetchMetrics = async () => {
    try {
      const response = await fetch(`${API_URL}/metrics`);
      const data = await response.json();
      if (data.success) {
        setMetrics(data.metrics);
      }
    } catch (err) {
      console.error('Failed to fetch metrics:', err);
    }
  };

  // Check order status via SSE
  const subscribeToOrderUpdates = (resId: string) => {
    const eventSource = new EventSource(`${API_URL}/orders/${resId}/stream`);
    
    eventSource.addEventListener('status', (event) => {
      const data = JSON.parse(event.data);
      setOrderStatus(data.status);
      
      if (data.status === 'paid' || data.status === 'failed') {
        eventSource.close();
      }
    });

    eventSource.onerror = () => {
      eventSource.close();
      // Fallback to polling
      pollOrderStatus(resId);
    };
  };

  // Poll order status (fallback)
  const pollOrderStatus = async (resId: string) => {
    const poll = async () => {
      try {
        const response = await fetch(`${API_URL}/orders/${resId}`);
        const data = await response.json();
        
        if (data.success) {
          setOrderStatus(data.order.status);
          
          if (data.order.status !== 'paid' && data.order.status !== 'failed') {
            setTimeout(poll, 2000);
          }
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    };
    
    poll();
  };

  // Handle purchase
  const handlePurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId.trim()) {
      setError('Please enter a user ID');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`${API_URL}/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: userId.trim(), saleId: SALE_ID }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Purchase reserved! Reservation ID: ${data.reservationId}`);
        subscribeToOrderUpdates(data.reservationId);
        fetchSaleStatus();
        fetchMetrics();
      } else {
        setError(data.message || data.error);
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh
  useEffect(() => {
    fetchSaleStatus();
    fetchMetrics();
    
    const interval = setInterval(() => {
      fetchSaleStatus();
      fetchMetrics();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (!saleStatus) return 'bg-gray-100';
    
    switch (saleStatus.status) {
      case 'active': return 'bg-green-100 border-green-500';
      case 'sold_out': return 'bg-red-100 border-red-500';
      case 'ended': return 'bg-gray-100 border-gray-500';
      case 'upcoming': return 'bg-blue-100 border-blue-500';
      default: return 'bg-gray-100';
    }
  };

  return (
    <div className="space-y-8">
      {/* Sale Status Card */}
      {saleStatus && (
        <div className={`rounded-lg shadow p-6 border-l-4 ${getStatusColor()}`}>
          <h2 className="text-2xl font-bold text-gray-900 mb-4">{saleStatus.productName}</h2>
          
          {saleStatus.isSoldOut && (
            <div className="bg-red-500 text-white px-4 py-2 rounded mb-4 font-bold text-center">
              ⚠️ SOLD OUT
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded shadow">
              <p className="text-sm text-gray-600">Stock Remaining</p>
              <p className="text-3xl font-bold text-primary-500">{saleStatus.stockRemaining}</p>
              <p className="text-sm text-gray-500">of {saleStatus.totalStock}</p>
            </div>
            
            <div className="bg-white p-4 rounded shadow">
              <p className="text-sm text-gray-600">Status</p>
              <p className="text-xl font-bold capitalize">{saleStatus.status.replace('_', ' ')}</p>
            </div>
            
            <div className="bg-white p-4 rounded shadow">
              <p className="text-sm text-gray-600">Purchased</p>
              <p className="text-3xl font-bold text-green-600">{saleStatus.purchasedCount}</p>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Form */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Purchase Item</h3>
        
        <form onSubmit={handlePurchase} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              User ID (email or username)
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              placeholder="user@example.com"
              disabled={loading || saleStatus?.isSoldOut}
            />
          </div>
          
          <button
            type="submit"
            disabled={loading || saleStatus?.isSoldOut || saleStatus?.status !== 'active'}
            className="w-full bg-primary-500 text-white py-3 px-4 rounded-lg font-semibold hover:bg-primary-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Processing...' : 'Buy Now'}
          </button>
        </form>

        {/* Error/Success Messages */}
        {error && (
          <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="mt-4 bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Order Status */}
        {orderStatus && (
          <div className="mt-4 bg-blue-50 border border-blue-300 text-blue-800 px-4 py-3 rounded">
            <p className="font-semibold">Order Status: <span className="capitalize">{orderStatus}</span></p>
            {orderStatus === 'paid' && <p className="text-green-600 mt-2">✓ Payment successful!</p>}
            {orderStatus === 'failed' && <p className="text-red-600 mt-2">✗ Payment failed</p>}
          </div>
        )}
      </div>

      {/* Metrics Card */}
      {metrics && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">System Metrics</h3>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-xs text-gray-600">Total Requests</p>
              <p className="text-xl font-bold">{metrics.requests}</p>
            </div>
            
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-xs text-gray-600">Purchases</p>
              <p className="text-xl font-bold text-green-600">{metrics.purchases}</p>
            </div>
            
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-xs text-gray-600">Circuit Breaker Hits</p>
              <p className="text-xl font-bold text-red-600">{metrics.circuitBreakerHits}</p>
              <p className="text-xs text-gray-500">{(metrics.circuitBreakerHitRate * 100).toFixed(1)}% rate</p>
            </div>
            
            <div className="bg-gray-50 p-3 rounded">
              <p className="text-xs text-gray-600">Queue Depth</p>
              <p className="text-xl font-bold">{metrics.queueDepth}</p>
              <p className="text-xs text-gray-500">{metrics.queueActive} active</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
