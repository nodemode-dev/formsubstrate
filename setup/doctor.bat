@echo off
setlocal
cd /d "%~dp0.."
set "FAIL=0"
where node >nul 2>nul && ( echo   ok     node ) || ( echo   FAIL   node, install Node 22 LTS & set "FAIL=1" )
where npm >nul 2>nul && ( echo   ok     npm ) || ( echo   FAIL   npm & set "FAIL=1" )
where py >nul 2>nul && ( echo   ok     python launcher ) || ( where python >nul 2>nul && ( echo   ok     python ) || ( echo   FAIL   Python 3.13+ is required & set "FAIL=1" ) )
where git >nul 2>nul && ( echo   ok     git ) || ( echo   warn   git, the workbench finds git on the system )
where claude >nul 2>nul && ( echo   ok     claude command ) || ( echo   warn   claude, Claude Code sessions need the claude command on the PATH )
if exist backend\venv\Scripts\activate.bat ( echo   ok     backend venv ) else ( echo   warn   backend venv, run formsubstrate.bat install )
if exist frontend\node_modules ( echo   ok     frontend node_modules ) else ( echo   warn   frontend deps, run formsubstrate.bat install )
where cargo >nul 2>nul && ( echo   ok     rust for desktop builds ) || ( echo   warn   rust, desktop builds need https://rustup.rs )
exit /b %FAIL%
