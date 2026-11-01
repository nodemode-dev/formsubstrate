@echo off
setlocal
cd /d "%~dp0.."
echo [subform] installing backend
pushd backend
call oc_install.bat || ( popd & exit /b 1 )
popd
echo [subform] installing frontend
pushd frontend
call oc_install.bat || ( popd & exit /b 1 )
popd
echo [subform] done. Boot with subform.bat
