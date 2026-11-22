@echo off
setlocal
cd /d "%~dp0"
set "PY="
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 13) else 1)" >nul 2>nul && set "PY=python"
if not defined PY py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 13) else 1)" >nul 2>nul && set "PY=py -3"
if not defined PY ( echo [formsubstrate] Python 3.13 or newer is required & exit /b 1 )
if not exist venv %PY% -m venv venv
if not exist venv\Scripts\activate.bat ( echo [formsubstrate] error: the engine venv could not be made in backend\venv & exit /b 1 )
call venv\Scripts\activate.bat
python -m pip install --upgrade pip || ( echo [formsubstrate] error: pip could not be upgraded in backend\venv & exit /b 1 )
pip install -r requirements.txt || ( echo [formsubstrate] error: the engine packages in requirements.txt could not be installed & exit /b 1 )
