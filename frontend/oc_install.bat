@echo off
setlocal
cd /d "%~dp0"
call npm ci || ( echo [formsubstrate] error: the window's packages could not be installed with npm ci & exit /b 1 )
