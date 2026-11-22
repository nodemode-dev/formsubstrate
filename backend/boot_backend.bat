@echo off
setlocal
cd /d "%~dp0"
if not exist venv\Scripts\activate.bat ( echo [formsubstrate] backend venv missing, run formsubstrate.bat install & exit /b 1 )
call venv\Scripts\activate.bat
if not defined FORMSUBSTRATE_PORT set "FORMSUBSTRATE_PORT=5655"
uvicorn app.main:app --reload --host 127.0.0.1 --port %FORMSUBSTRATE_PORT%
