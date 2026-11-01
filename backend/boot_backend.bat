@echo off
setlocal
cd /d "%~dp0"
if not exist venv\Scripts\activate.bat ( echo [subform] backend venv missing, run subform.bat install & exit /b 1 )
call venv\Scripts\activate.bat
if not defined SUBFORM_HOST set "SUBFORM_HOST=127.0.0.1"
if not defined SUBFORM_PORT set "SUBFORM_PORT=5655"
uvicorn app.main:app --reload --host %SUBFORM_HOST% --port %SUBFORM_PORT%
