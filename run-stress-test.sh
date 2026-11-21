#!/bin/bash

# Flash Sale System - Stress Test Script

set -e

echo "🚀 Running Flash Sale System Stress Test"
echo ""

# Check if Artillery is installed
if ! command -v artillery &> /dev/null; then
    echo "📦 Installing Artillery..."
    npm install -g artillery
fi

# Determine the port to use (nginx gateway)
NGINX_PORT=${NGINX_PORT:-8080}
API_URL="http://localhost:${NGINX_PORT}"

# Check if system is running
echo "🔍 Checking if system is running on ${API_URL}..."
if ! curl -s ${API_URL}/health > /dev/null; then
    echo "❌ System is not running. Please start with ./start.sh first"
    exit 1
fi

echo "✅ System is healthy"
echo ""

# Get initial metrics
echo "📊 Initial Metrics:"
if command -v jq &> /dev/null; then
    curl -s ${API_URL}/api/metrics | jq .
else
    curl -s ${API_URL}/api/metrics
fi
echo ""

# Run stress test
echo "🔥 Starting stress test..."
NGINX_PORT=${NGINX_PORT} artillery run stress-test/flash-sale-load.yml --output stress-test-report.json

echo ""
echo "✅ Stress test completed"
echo ""

# Get final metrics
echo "📊 Final Metrics:"
if command -v jq &> /dev/null; then
    curl -s ${API_URL}/api/metrics | jq .
else
    curl -s ${API_URL}/api/metrics
fi
echo ""

# Generate HTML report
echo "📈 Generating HTML report..."
artillery report stress-test-report.json --output stress-test-report.html

echo ""
echo "✅ Test complete! Reports generated:"
echo "  - JSON: stress-test-report.json"
echo "  - HTML: stress-test-report.html"
echo ""
echo "📊 Flash Sale Burst Test Results to Verify:"
echo "  1. System survives 10k concurrent burst (3 seconds)"
echo "  2. No overselling (exactly 100 orders fulfilled)"
echo "  3. Circuit breaker activates quickly after sellout"
echo "  4. Response time <100ms for circuit-broken requests"
echo "  5. 9,900+ users get immediate 'sold out' response (409)"
echo "  6. Zero duplicate reservations or race conditions"
