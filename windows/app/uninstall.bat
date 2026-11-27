@echo off
setlocal EnableExtensions
title HamShack by M0GLP ^& M3VRV - Uninstall
set "DEST=%~dp0"
if "%DEST:~-1%"=="\" set "DEST=%DEST:~0,-1%"

echo.
choice /C YN /M "  Remove HamShack by M0GLP & M3VRV (and ClearRX) from this PC"
if errorlevel 2 exit /b 0

call "%~dp0stop-bandwatch.bat" quiet
if exist "%~dp0ClearRX.exe" "%~dp0ClearRX.exe" --stop >nul 2>nul
if exist "%~dp0ClearRX\ClearRX.exe" "%~dp0ClearRX\ClearRX.exe" --stop >nul 2>nul
taskkill /im ClearRX.exe /f >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0make-shortcuts.ps1" -InstallDir "%DEST%" -Remove
rem Remove the entry in Settings > Apps (made by BandWatch-Setup.exe).
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BandWatchM3vrv" /f >nul 2>nul

echo   HamShack has been removed. Your settings stay in your web browser until you clear them.
echo.
pause
rem Leave the folder before deleting it, including this file.
cd /d "%TEMP%"
(rmdir /s /q "%DEST%") 2>nul & exit /b 0
