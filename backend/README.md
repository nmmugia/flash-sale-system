# Flash Sale Backend

## Quick Start

### Option 1: Run Everything with Docker (Recommended)

From the project root:
```bash
./start.sh
```

This starts all services in Docker containers.

### Option 2: Run Backend Locally (Development)

1. **Start required services with Docker:**
   ```bash
   # From project root
   docker-compose up -d postgres redis pgbouncer
   ```

2. **Install dependencies:**
   ```bash
   cd backend
   pnpm install
   ```

3. **Build TypeScript:**
   ```bash
   pnpm run build
   ```

4. **Start the API:**
   ```bash
   pnpm run start
   ```

   Or for development with hot reload:
   ```bash
   pnpm run dev
   ```

5. **Start the worker (in another terminal):**
   ```bash
   pnpm run worker
   ```

### Environment Variables

The `.env` file is already configured for local development. It connects to:
- PostgreSQL: localhost:5432
- Redis: localhost:6379
- PgBouncer: localhost:6432

### Check Services

To verify PostgreSQL and Redis are running:
```bash
bash check-services.sh
```

## Development Commands

```bash
# Build TypeScript
pnpm run build

# Start API (production)
pnpm run start

# Start API (development with hot reload)
pnpm run dev

# Start Worker (production)
pnpm run worker

# Start Worker (development)
pnpm run worker:dev

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Lint code
pnpm run lint

# Format code
pnpm run format
```

## Troubleshooting

### "SALE_ID: Required" error

Make sure the `.env` file exists in the backend directory. It should be created automatically.

### "Connection refused" errors

Start the required services:
```bash
# From project root
docker-compose up -d postgres redis pgbouncer
```

### Port already in use

```bash
# Stop existing services
docker-compose down

# Start again
docker-compose up -d postgres redis pgbouncer
```

## Testing the API

Once running, test with:

```bash
# Health check
curl http://localhost:3000/health

# Get sale status
curl http://localhost:3000/api/sales/550e8400-e29b-41d4-a716-446655440000/status

# Attempt purchase
curl -X POST http://localhost:3000/api/purchases \
  -H "Content-Type: application/json" \
  -d '{"userId":"test@example.com","saleId":"550e8400-e29b-41d4-a716-446655440000"}'

# Check metrics
curl http://localhost:3000/api/metrics
```
