@echo off
setlocal
cd /d "%~dp0"

echo [LegaSeen] Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS, then run this file again.
  pause
  exit /b 1
)

echo [LegaSeen] Removing any incomplete dependency installation...
if exist node_modules rmdir /s /q node_modules

echo [LegaSeen] Verifying the npm cache...
call npm cache verify
if errorlevel 1 goto :failed

echo [LegaSeen] Installing exact dependency versions...
call npm ci
if errorlevel 1 goto :failed

echo [LegaSeen] Starting the website...
call npm run dev
exit /b %errorlevel%

:failed
echo.
echo Installation failed. Check your internet connection and try again.
pause
exit /b 1