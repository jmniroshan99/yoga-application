@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 (
  echo Could not open the Sahana project folder.
  pause
  exit /b 1
)
title Sahana Yoga - Full Stack
echo.
echo === Sahana Yoga: start the full system ===
echo Checking database configuration before starting the website...
call "%~dp0DATABASE_SETUP.bat" --no-pause
if errorlevel 1 goto :failed

node "scripts\check-local-ports.mjs"
if errorlevel 1 goto :failed

rem Prevent a machine-wide variable from overriding the private project .env.
set "DATABASE_URL="
set "DATA_ENCRYPTION_KEY="
set "PORT="
set "WEB_ORIGIN="
echo.
echo Starting the API and website. Keep this window open.
echo Open http://localhost:5173/ in your browser.
echo Press Ctrl+C to stop the system.
echo.
call npm run dev
if errorlevel 1 goto :failed
popd
pause
exit /b 0

:failed
echo.
echo Sahana did not start. Review the error above and run this file again.
popd
pause
exit /b 1
