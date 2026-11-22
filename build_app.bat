@echo off
setlocal
cd /d "%~dp0"
set "ROOT=%cd%"
where node >nul 2>nul || ( echo [formsubstrate] Node 20.19 or newer is required & exit /b 1 )
where cargo >nul 2>nul || ( echo [formsubstrate] Rust is missing, install it from https://rustup.rs & exit /b 1 )
if not exist backend\venv\Scripts\activate.bat (
  pushd backend
  call oc_install.bat
  if errorlevel 1 ( popd & echo [formsubstrate] error: the engine install failed, see the output above & exit /b 1 )
  popd
)
if not exist frontend\node_modules\.bin\tauri.cmd (
  pushd frontend
  call npm ci
  if errorlevel 1 ( popd & echo [formsubstrate] error: the window packages could not be installed with npm ci, see the output above & exit /b 1 )
  popd
)
if not exist frontend\node_modules\.bin\tauri.cmd ( echo [formsubstrate] error: frontend\node_modules\.bin\tauri.cmd is missing after the install & exit /b 1 )
call backend\venv\Scripts\activate.bat
pip install -q -r backend\requirements_build.txt || exit /b 1
set "DIST=%ROOT%\frontend\dist"
if defined FORMSUBSTRATE_FRONTEND_DIST set "DIST=%FORMSUBSTRATE_FRONTEND_DIST%"
set "FORMSUBSTRATE_FRONTEND_DIST=%DIST%"
pushd frontend
call npx vite build --outDir "%DIST%" --emptyOutDir || exit /b 1
popd
call setup\freeze_backend.bat || exit /b 1
set "ENGINE=%ROOT%\src-tauri\engine"
if defined FORMSUBSTRATE_ENGINE_OUT set "ENGINE=%FORMSUBSTRATE_ENGINE_OUT%"
set "ENGINE_JSON=%ENGINE:\=/%"
set "DIST_JSON=%DIST:\=/%"
call frontend\node_modules\.bin\tauri.cmd build --config "{\"build\":{\"frontendDist\":\"%DIST_JSON%\"},\"bundle\":{\"resources\":{\"%ENGINE_JSON%\":\"engine\"}}}" || exit /b 1
echo [formsubstrate] done. Bundles are under src-tauri\target\release\bundle
