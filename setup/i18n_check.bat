@echo off
setlocal
cd /d "%~dp0..\frontend"
where node >nul 2>nul || ( echo [formsubstrate] error: node is required, install Node 22 LTS & exit /b 1 )
echo [formsubstrate] i18n
node scripts\i18n-check.mjs %*
if errorlevel 1 ( echo [formsubstrate] fix the FAIL lines above & exit /b 1 )
echo [formsubstrate] ready
exit /b 0
