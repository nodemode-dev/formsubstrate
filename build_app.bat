@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%cd%"
where node >nul 2>nul || ( echo [subform] Node 20.19 or newer is required & exit /b 1 )
where cargo >nul 2>nul || ( echo [subform] Rust is missing, install it from https://rustup.rs & exit /b 1 )
if not exist backend\venv\Scripts\activate.bat ( pushd backend & call oc_install.bat & popd )
if not exist frontend\node_modules ( pushd frontend & call npm install & popd )
call backend\venv\Scripts\activate.bat
pip install -q -r backend\requirements_build.txt || exit /b 1
set "DIST=%ROOT%\frontend\dist"
if defined SUBFORM_FRONTEND_DIST set "DIST=%SUBFORM_FRONTEND_DIST%"
set "SUBFORM_FRONTEND_DIST=%DIST%"
pushd frontend
call npx vite build --outDir "%DIST%" --emptyOutDir || exit /b 1
popd
call setup\freeze_backend.bat || exit /b 1
set "ENGINE=%ROOT%\src-tauri\engine"
if defined SUBFORM_ENGINE_OUT set "ENGINE=%SUBFORM_ENGINE_OUT%"
set "ENGINE_JSON=%ENGINE:\=/%"
set "DIST_JSON=%DIST:\=/%"
call frontend\node_modules\.bin\tauri.cmd build --config "{\"build\":{\"frontendDist\":\"%DIST_JSON%\"},\"bundle\":{\"resources\":{\"%ENGINE_JSON%\":\"engine\"}}}" || exit /b 1
echo [subform] done. Bundles are under src-tauri\target\release\bundle
