@echo off
cd /d "%~dp0"
echo Installing subform. This can take a few minutes.
echo.
call subform_oc_install.bat
if errorlevel 1 (
  echo.
  echo The install stopped. Read the message above, fix it, and run this file again.
) else (
  echo.
  echo subform is installed. Start it any time with subform.bat in this folder.
)
echo.
pause
