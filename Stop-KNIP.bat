@echo off
cd /d "%~dp0"
docker compose down
echo KNIP has stopped.
pause
