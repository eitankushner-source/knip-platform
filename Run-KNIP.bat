@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is required. Please install or start Docker Desktop.
  pause
  exit /b 1
)
docker compose up --build -d
if errorlevel 1 (
  echo KNIP failed to start.
  pause
  exit /b 1
)
start "" http://localhost:3000
echo KNIP is running at http://localhost:3000
pause
