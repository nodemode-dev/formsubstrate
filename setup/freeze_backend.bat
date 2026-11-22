@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
if not exist backend\venv\Scripts\activate.bat ( echo [formsubstrate] backend venv missing, run formsubstrate.bat install & exit /b 1 )
call backend\venv\Scripts\activate.bat
python -c "import PyInstaller" >nul 2>nul || ( echo [formsubstrate] PyInstaller missing, run: pip install -r backend\requirements_build.txt & exit /b 1 )
set "DIST=%ROOT%\frontend\dist"
if defined FORMSUBSTRATE_FRONTEND_DIST set "DIST=%FORMSUBSTRATE_FRONTEND_DIST%"
if not exist "%DIST%\index.html" ( echo [formsubstrate] the built window is missing at %DIST%, run build_app.bat & exit /b 1 )
set "WORK=%ROOT%\backend"
if defined FORMSUBSTRATE_FREEZE_WORK set "WORK=%FORMSUBSTRATE_FREEZE_WORK%"
set "OUT=%ROOT%\src-tauri\engine"
if defined FORMSUBSTRATE_ENGINE_OUT set "OUT=%FORMSUBSTRATE_ENGINE_OUT%"
if exist "%WORK%\build\pyinstaller" rmdir /s /q "%WORK%\build\pyinstaller"
if exist "%WORK%\dist-engine" rmdir /s /q "%WORK%\dist-engine"
cd backend
pyinstaller --noconfirm --clean --onedir --name formsubstrate-engine --distpath "%WORK%\dist-engine" --workpath "%WORK%\build\pyinstaller" --specpath "%WORK%\build\pyinstaller" --add-data "%DIST%;frontend_dist" --add-data "%ROOT%\backend\app\templates;app/templates" --add-data "%ROOT%\backend\presets\graphs;presets/graphs" --add-data "%ROOT%\backend\presets\plugins;presets/plugins" --add-data "%ROOT%\backend\presets\skills;presets/skills"--add-data "%ROOT%\backend\app\services\recipes\presets;app/services/recipes/presets" --add-data "%ROOT%\backend\app\services\library\bundled;app/services/library/bundled" --add-data "%ROOT%\backend\skills;skills" --collect-submodules app --collect-submodules uvicorn --collect-submodules keyring --copy-metadata keyring --hidden-import formsubstrate_ptyhost --hidden-import winpty --hidden-import app.services.gate_hook --exclude-module tkinter "%ROOT%\backend\formsubstrate_engine.py" || exit /b 1
if exist "%OUT%" rmdir /s /q "%OUT%"
xcopy /e /i /q /y "%WORK%\dist-engine\formsubstrate-engine" "%OUT%" >nul || exit /b 1
"%OUT%\formsubstrate-engine.exe" --selfcheck || exit /b 1
echo [formsubstrate] engine folder ready: %OUT%
