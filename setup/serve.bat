@echo off
setlocal
cd /d "%~dp0.."
if not exist frontend\dist\index.html ( pushd frontend & call npm run build & popd )
set "FORMSUBSTRATE_DIST=%cd%\frontend\dist"
cd backend
if not exist venv\Scripts\activate.bat ( echo [formsubstrate] backend venv missing, run formsubstrate.bat install & exit /b 1 )
call venv\Scripts\activate.bat
if not defined FORMSUBSTRATE_PORT set "FORMSUBSTRATE_PORT=5655"
echo [formsubstrate] serving http://127.0.0.1:%FORMSUBSTRATE_PORT%
uvicorn app.main:app --host 127.0.0.1 --port %FORMSUBSTRATE_PORT%
