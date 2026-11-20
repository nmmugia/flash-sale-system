#!/bin/bash

echo "🔍 Checking required services..."

# Check PostgreSQL
if ! nc -z localhost 5432 2>/dev/null; then
    echo "❌ PostgreSQL is not running on localhost:5432"
    echo "   Start it with: docker-compose up -d postgres"
    exit 1
fi
echo "✅ PostgreSQL is running"

# Check Redis
if ! nc -z localhost 6379 2>/dev/null; then
    echo "❌ Redis is not running on localhost:6379"
    echo "   Start it with: docker-compose up -d redis"
    exit 1
fi
echo "✅ Redis is running"

# Check PgBouncer (optional)
if nc -z localhost 6432 2>/dev/null; then
    echo "✅ PgBouncer is running"
    echo "   Using PgBouncer connection pooling"
else
    echo "⚠️  PgBouncer is not running (optional)"
    echo "   You can start it with: docker-compose up -d pgbouncer"
fi

echo ""
echo "✅ All required services are running!"
echo "   You can now start the backend with: pnpm run start"
