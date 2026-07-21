@echo off
cd /d "%~dp0"
docker compose down -v
docker compose up --build -d
start "" http://localhost:3000
echo KNIP data was reset.
pause
