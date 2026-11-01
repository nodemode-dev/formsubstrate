@echo off
setlocal
cd /d "%~dp0.."
set "ROOT=%cd%"
if not exist backend\venv\Scripts\activate.bat ( echo [subform] backend venv missing, run subform.bat install & exit /b 1 )
call backend\venv\Scripts\activate.bat
python -c "import PyInstaller" >nul 2>nul || ( echo [subform] PyInstaller missing, run: pip install -r backend\requirements_build.txt & exit /b 1 )
set "DIST=%ROOT%\frontend\dist"
if defined SUBFORM_FRONTEND_DIST set "DIST=%SUBFORM_FRONTEND_DIST%"
if not exist "%DIST%\index.html" ( echo [subform] the built window is missing at %DIST%, run build_app.bat & exit /b 1 )
set "WORK=%ROOT%\backend"
if defined SUBFORM_FREEZE_WORK set "WORK=%SUBFORM_FREEZE_WORK%"
set "OUT=%ROOT%\src-tauri\engine"
if defined SUBFORM_ENGINE_OUT set "OUT=%SUBFORM_ENGINE_OUT%"
if exist "%WORK%\build\pyinstaller" rmdir /s /q "%WORK%\build\pyinstaller"
if exist "%WORK%\dist-engine" rmdir /s /q "%WORK%\dist-engine"
cd backend
pyinstaller --noconfirm --clean --onedir --name subform-engine --distpath "%WORK%\dist-engine" --workpath "%WORK%\build\pyinstaller" --specpath "%WORK%\build\pyinstaller" --add-data "%DIST%;frontend_dist" --add-data "%ROOT%\backend\app\templates;app/templates" --add-data "%ROOT%\backend\presets\graphs;presets/graphs" --add-data "%ROOT%\backend\presets\plugins;presets/plugins" --add-data "%ROOT%\backend\presets\skills;presets/skills"--add-data "%ROOT%\backend\app\services\recipes\presets;app/services/recipes/presets" --add-data "%ROOT%\backend\app\services\library\bundled;app/services/library/bundled" --add-data "%ROOT%\backend\skills;skills" --collect-submodules app --collect-submodules uvicorn --collect-submodules keyring --copy-metadata keyring --hidden-import subform_ptyhost --hidden-import winpty --hidden-import app.services.gate_hook --exclude-module tkinter "%ROOT%\backend\subform_engine.py" || exit /b 1
if exist "%OUT%" rmdir /s /q "%OUT%"
xcopy /e /i /q /y "%WORK%\dist-engine\subform-engine" "%OUT%" >nul || exit /b 1
"%OUT%\subform-engine.exe" --selfcheck || exit /b 1
echo [subform] engine folder ready: %OUT%
