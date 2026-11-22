@echo off
setlocal
cd /d "%~dp0"
set "CMD=%~1"
set "ARG=%~2"
if "%CMD%"=="" set "CMD=boot"
if /i "%CMD%"=="boot" ( call setup\boot_all.bat & exit /b )
if /i "%CMD%"=="dev" ( call setup\boot_all.bat & exit /b )
if /i "%CMD%"=="install" ( call setup\install_all.bat & exit /b )
if /i "%CMD%"=="backend" ( call setup\boot_backend.bat & exit /b )
if /i "%CMD%"=="frontend" ( call setup\boot_frontend.bat & exit /b )
if /i "%CMD%"=="serve" ( call setup\serve.bat & exit /b )
if /i "%CMD%"=="doctor" ( call setup\doctor.bat & exit /b )
if /i "%CMD%"=="i18n" ( call setup\i18n_check.bat & exit /b )
if /i "%CMD%"=="mcp" (
  if exist "backend\venv\Scripts\python.exe" ( "backend\venv\Scripts\python.exe" backend\formsubstrate_mcp.py ) else ( python backend\formsubstrate_mcp.py )
  exit /b
)
if /i "%CMD%"=="agents" ( call setup\agents.bat %2 %3 %4 %5 & exit /b )
if /i "%CMD%"=="clean" ( call setup\clean.bat %ARG% & exit /b )
if /i "%CMD%"=="help" (
  echo formsubstrate.bat [command]
  echo   boot ^| install ^| backend ^| frontend ^| serve ^| doctor ^| mcp ^| clean [--all] ^| help
  exit /b 0
)
echo [formsubstrate] unknown command: %CMD%
echo formsubstrate.bat [command]
echo   boot ^| install ^| backend ^| frontend ^| serve ^| doctor ^| mcp ^| clean [--all] ^| help
exit /b 2
