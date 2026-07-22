@echo off
cd /d "%~dp0.."
if not exist backend\.env copy backend\.env.example backend\.env >nul
docker compose up --build
