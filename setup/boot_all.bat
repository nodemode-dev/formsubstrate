@echo off
setlocal
cd /d "%~dp0.."
start "formsubstrate backend" cmd /k "cd /d %cd%\backend && boot_backend.bat"
start "formsubstrate frontend" cmd /k "cd /d %cd%\frontend && boot_frontend.bat"
echo [formsubstrate] frontend http://localhost:5650 and backend http://127.0.0.1:5655
