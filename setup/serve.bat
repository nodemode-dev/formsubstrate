@echo off
setlocal
cd /d "%~dp0.."
if not exist frontend\dist\index.html ( pushd frontend & call npm run build & popd )
set "SUBFORM_DIST=%cd%\frontend\dist"
cd backend
if not exist venv\Scripts\activate.bat ( echo [subform] backend venv missing, run subform.bat install & exit /b 1 )
call venv\Scripts\activate.bat
if not defined SUBFORM_PORT set "SUBFORM_PORT=5655"
echo [subform] serving http://127.0.0.1:%SUBFORM_PORT%
uvicorn app.main:app --host 127.0.0.1 --port %SUBFORM_PORT%
