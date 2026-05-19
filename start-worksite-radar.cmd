@echo off
setlocal
cd /d "%~dp0"

start "Worksite Radar - Web + RCM Image" powershell -NoExit -ExecutionPolicy Bypass -Command "npm run dev"
start "Worksite Radar - Attendance Watch" powershell -NoExit -ExecutionPolicy Bypass -Command "npm run attendance:watch"

echo Worksite Radar local services are starting.
echo.
echo Web app + RCM image server: npm run dev
echo Attendance watcher: npm run attendance:watch
echo.
echo You can close the opened PowerShell windows to stop them.
pause
