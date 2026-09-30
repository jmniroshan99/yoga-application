@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 (
  echo Could not open the Sahana project folder.
  pause
  exit /b 1
)
title Sahana Yoga - Database Setup
echo.
echo === Sahana Yoga: PostgreSQL setup ===
echo This will reuse your existing database or set up a new local database.
echo.
where node.exe >nul 2>&1
if errorlevel 1 goto :missing_node
where npm.cmd >nul 2>&1
if errorlevel 1 goto :missing_node

echo Checking project packages...
call npm install
if errorlevel 1 goto :failed

node "scripts\prepare-windows-env.mjs"
if errorlevel 1 goto :failed

rem The project .env is authoritative even if an old system variable is set.
set "DATABASE_URL="
set "DATA_ENCRYPTION_KEY="
set "ADMIN_PASSWORD="
set "DEMO_PASSWORD="
echo.
echo Checking PostgreSQL and applying pending migrations...
call npm run setup:local
if errorlevel 1 goto :failed

echo.
echo Database is ready. Run RUN_SYSTEM.bat to start the website.
popd
if /i "%~1"=="--no-pause" exit /b 0
pause
exit /b 0

:missing_node
echo Node.js and npm are required. Install Node.js 20 or newer, then reopen this file.
:failed
echo.
echo Database setup stopped. Read the error above; your existing data was not deleted.
popd
if /i "%~1"=="--no-pause" exit /b 1
pause
exit /b 1
