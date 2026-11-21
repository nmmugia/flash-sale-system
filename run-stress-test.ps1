# Flash Sale System - Stress Test Script (PowerShell)

$ErrorActionPreference = "Stop"

Write-Host "[*] Running Flash Sale System Stress Test" -ForegroundColor Cyan
Write-Host ""

# Check if Artillery is installed
$artilleryInstalled = Get-Command artillery -ErrorAction SilentlyContinue
if (-not $artilleryInstalled) {
    Write-Host "[*] Installing Artillery..." -ForegroundColor Yellow
    npm install -g artillery
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Failed to install Artillery" -ForegroundColor Red
        exit 1
    }
}

# Determine the port to use (nginx gateway)
$NGINX_PORT = if ($env:NGINX_PORT) { $env:NGINX_PORT } else { "8080" }
$API_URL = "http://localhost:$NGINX_PORT"

# Check if system is running
Write-Host "[*] Checking if system is running on $API_URL..." -ForegroundColor Cyan
try {
    $null = Invoke-WebRequest -Uri "$API_URL/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "[OK] System is healthy" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] System is not running. Please start with docker-compose up first" -ForegroundColor Red
    exit 1
}
Write-Host ""

# Get initial metrics
Write-Host "[*] Initial Metrics:" -ForegroundColor Cyan
$jqInstalled = Get-Command jq -ErrorAction SilentlyContinue
if ($jqInstalled) {
    curl -s "$API_URL/api/metrics" | jq .
} else {
    $response = Invoke-RestMethod -Uri "$API_URL/api/metrics"
    $response | ConvertTo-Json -Depth 10
}
Write-Host ""

# Run stress test
Write-Host "[*] Starting stress test..." -ForegroundColor Cyan
$env:NGINX_PORT = $NGINX_PORT
artillery run stress-test/flash-sale-load.yml --output stress-test-report.json
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Stress test failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[OK] Stress test completed" -ForegroundColor Green
Write-Host ""

# Get final metrics
Write-Host "[*] Final Metrics:" -ForegroundColor Cyan
if ($jqInstalled) {
    curl -s "$API_URL/api/metrics" | jq .
} else {
    $response = Invoke-RestMethod -Uri "$API_URL/api/metrics"
    $response | ConvertTo-Json -Depth 10
}
Write-Host ""

# Generate HTML report
Write-Host "[*] Generating HTML report..." -ForegroundColor Cyan
artillery report stress-test-report.json --output stress-test-report.html

Write-Host ""
Write-Host "[OK] Test complete! Reports generated:" -ForegroundColor Green
Write-Host "  - JSON: stress-test-report.json"
Write-Host "  - HTML: stress-test-report.html"
Write-Host ""
Write-Host "[*] Flash Sale Burst Test Results to Verify:" -ForegroundColor Cyan
Write-Host "  1. System survives 10k concurrent burst (3 seconds)"
Write-Host "  2. No overselling (exactly 100 orders fulfilled)"
Write-Host "  3. Circuit breaker activates quickly after sellout"
Write-Host "  4. Response time <100ms for circuit-broken requests"
Write-Host "  5. 9,900+ users get immediate 'sold out' response (409)"
Write-Host "  6. Zero duplicate reservations or race conditions"
