@echo off
REM Flash Sale System - Stress Test Script (Windows)

setlocal enabledelayedexpansion

echo [*] Running Flash Sale System Stress Test
echo.

REM Check if Artillery is installed
where artillery >nul 2>nul
if %errorlevel% neq 0 (
    echo [*] Installing Artillery...
    call npm install -g artillery
    if !errorlevel! neq 0 (
        echo [ERROR] Failed to install Artillery
        exit /b 1
    )
)

REM Determine the port to use (nginx gateway)
if not defined NGINX_PORT set NGINX_PORT=8080
set API_URL=http://localhost:%NGINX_PORT%

REM Check if system is running
echo [*] Checking if system is running on %API_URL%...
curl -s -f -o nul %API_URL%/health
if %errorlevel% neq 0 (
    echo [ERROR] System is not running. Please start with docker-compose up first
    exit /b 1
)

echo [OK] System is healthy
echo.

REM Get initial metrics
echo [*] Initial Metrics:
where jq >nul 2>nul
if %errorlevel% equ 0 (
    curl -s %API_URL%/api/metrics | jq .
) else (
    curl -s %API_URL%/api/metrics
)
echo.

REM Run stress test
echo [*] Starting stress test...
set NGINX_PORT=%NGINX_PORT%
artillery run stress-test/flash-sale-load.yml --output stress-test-report.json
if %errorlevel% neq 0 (
    echo [ERROR] Stress test failed
    exit /b 1
)

echo.
echo [OK] Stress test completed
echo.

REM Get final metrics
echo [*] Final Metrics:
where jq >nul 2>nul
if %errorlevel% equ 0 (
    curl -s %API_URL%/api/metrics | jq .
) else (
    curl -s %API_URL%/api/metrics
)
echo.

REM Generate HTML report
echo [*] Generating HTML report...
artillery report stress-test-report.json --output stress-test-report.html

echo.
echo [OK] Test complete! Reports generated:
echo   - JSON: stress-test-report.json
echo   - HTML: stress-test-report.html
echo.
echo [*] Flash Sale Burst Test Results to Verify:
echo   1. System survives 10k concurrent burst (3 seconds)
echo   2. No overselling (exactly 100 orders fulfilled)
echo   3. Circuit breaker activates quickly after sellout
echo   4. Response time ^<100ms for circuit-broken requests
echo   5. 9,900+ users get immediate 'sold out' response (409)
echo   6. Zero duplicate reservations or race conditions

endlocal
