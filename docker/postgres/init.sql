-- Flash Sale System Database Initialization
-- This script is executed once when the PostgreSQL container starts

-- Create sales table
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY,
  product_name VARCHAR(255) NOT NULL,
  total_stock INTEGER NOT NULL CHECK (total_stock >= 0),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- Create orders table
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  user_id VARCHAR(255) NOT NULL,
  reservation_id UUID UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'cancelled')),
  payment_attempts INTEGER DEFAULT 0 CHECK (payment_attempts >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_orders_user_sale ON orders(user_id, sale_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_reservation ON orders(reservation_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Insert seed data for flash sale
INSERT INTO sales (id, product_name, total_stock, start_time, end_time)
VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'Limited Edition Sneakers',
  100,
  NOW() - INTERVAL '1 hour',  -- Started 1 hour ago
  NOW() + INTERVAL '24 hours'  -- Ends in 24 hours
)
ON CONFLICT (id) DO NOTHING;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'Flash Sale System database initialized successfully';
END $$;
