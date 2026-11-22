@echo off
setlocal
cd /d "%~dp0.."
echo [formsubstrate] installing backend
pushd backend
call oc_install.bat || ( popd & exit /b 1 )
popd
echo [formsubstrate] installing frontend
pushd frontend
call oc_install.bat || ( popd & exit /b 1 )
popd
echo [formsubstrate] done. Boot with formsubstrate.bat
