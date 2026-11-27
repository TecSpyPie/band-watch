@echo off
setlocal EnableExtensions
rem Stops HamShack, whether it runs as BandWatch.exe or under Node.js. Pass "quiet" to skip the message.
if exist "%~dp0BandWatch.exe" "%~dp0BandWatch.exe" --stop >nul 2>nul
taskkill /im BandWatch.exe /f >nul 2>nul
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -match 'BandWatch' -and $_.CommandLine -match 'server\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>nul
if /i not "%~1"=="quiet" (
  echo HamShack has been stopped.
  timeout /t 2 /nobreak >nul
)
exit /b 0
