@echo off
setlocal
cd /d "%~dp0"
node -e "process.exit(+process.versions.node.split('.')[0]<22?1:0)" >nul 2>&1
if errorlevel 1 (
  echo Nainstaluj Node.js 22 nebo novejsi z https://nodejs.org a spust tento soubor znovu.
  pause
  exit /b 1
)
if not exist apps\web\node_modules\.bin\next.cmd call npm --prefix apps/web ci --no-audit --no-fund
if errorlevel 1 exit /b 1
if not exist demo\node_modules\@electric-sql\pglite call npm --prefix demo ci --no-audit --no-fund
if errorlevel 1 exit /b 1
node demo/start.mjs
pause
