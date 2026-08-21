@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
)

netstat -ano | findstr /R /C:":4173 .*LISTENING" >nul
if errorlevel 1 (
  start "Legal Document Compare" /min cmd /c "npm start"
  timeout /t 2 /nobreak >nul
)

start "" "http://localhost:4173/"
endlocal
