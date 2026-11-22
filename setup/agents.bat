@echo off
setlocal
cd /d "%~dp0.."
set "PY=python"
if exist "backend\venv\Scripts\python.exe" set "PY=backend\venv\Scripts\python.exe"
"%PY%" setup\agents.py %*
exit /b %errorlevel%
