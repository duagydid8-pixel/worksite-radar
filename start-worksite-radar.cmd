@echo off
setlocal
cd /d "%~dp0"

start "Worksite Radar - Web + RCM Image" powershell -NoExit -ExecutionPolicy Bypass -Command "npm run dev"
start "Worksite Radar - Attendance Watch" powershell -NoExit -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) { Write-Host 'Attendance watcher is already running on port 8787.'; Write-Host 'Close this window or press Ctrl+C if you do not need it.' } else { npm run attendance:watch }"

echo Worksite Radar local services are starting.
echo.
echo Web app + RCM image server: npm run dev
echo Attendance watcher: npm run attendance:watch
echo.
echo You can close the opened PowerShell windows to stop them.
pause
