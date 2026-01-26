@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [dev-debug] Node.js not found. Install Node.js first.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [dev-debug] npm not found. Install Node.js first.
  pause
  exit /b 1
)

set "ARGS=%*"
if "%ARGS%"=="" set "ARGS=--watch"

npm run dev:debug -- %ARGS%
if errorlevel 1 (
  echo [dev-debug] Failed with exit code %errorlevel%.
  pause
  exit /b %errorlevel%
)

endlocal
