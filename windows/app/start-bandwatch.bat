@echo off
setlocal EnableExtensions
rem Starts HamShack: BandWatch.exe if Windows lets it run. If Windows blocks it (for example
rem Smart App Control, which blocks programs without a paid signing certificate), it starts the
rem same server with Node.js instead, if Node.js is installed. Pass --background to skip the browser.
cd /d "%~dp0"
set "URL=http://localhost:8073/"
set "BG="
if /i "%~1"=="--background" set "BG=1"

if not exist "%~dp0BandWatch.exe" goto :fallback
rem With Smart App Control on, Windows blocks BandWatch.exe, so go straight to Node.js.
set "SAC=0"
for /f "tokens=3" %%v in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v VerifiedAndReputablePolicyState 2^>nul ^| find "0x"') do set /a "SAC=%%v"
if "%SAC%"=="1" goto :fallback
start "" "%~dp0BandWatch.exe" %*
rem Give Windows a moment to start it (or block it).
call :sleep
call :sleep
call :sleep
tasklist /fi "imagename eq BandWatch.exe" 2>nul | find /i "BandWatch.exe" >nul
if errorlevel 1 goto :fallback
rem BandWatch.exe is running: it opens the browser itself.
exit /b 0

:fallback
call :status
rem 2: BandWatch.exe already answered (it opened the browser itself). 1: an older or Node.js HamShack.
if "%BWSTATUS%"=="2" exit /b 0
if "%BWSTATUS%"=="1" goto :open
set "NODE="
for /f "delims=" %%n in ('where node 2^>nul') do if not defined NODE set "NODE=%%n"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE goto :fail
if not exist "%~dp0server\server.js" goto :fail
set "PORT=8073"
set "HOST=127.0.0.1"
rem Lets the RTL-SDR receiver reach rtl_tcp (only ever switched on here, on your own PC).
set "BW_SDR=1"
start "HamShack server - close this window to stop" /min "%NODE%" "%~dp0server\server.js"
set /a N=0
:waitnode
call :status
if not "%BWSTATUS%"=="0" goto :open
set /a N+=1
if %N% GEQ 40 goto :fail
call :sleep
goto :waitnode

:open
if defined BG exit /b 0
start "" "%URL%"
exit /b 0

:fail
echo.
echo   HamShack couldn't start.
echo   If Windows blocks BandWatch.exe (Smart App Control), install Node.js LTS from
echo   https://nodejs.org and open HamShack again: it will run with Node.js instead.
echo   Or use the online version at https://band-watch.ample.run
echo.
pause
exit /b 1

rem BWSTATUS: 2 when BandWatch.exe answers on port 8073, 1 for any other HamShack, otherwise 0.
:status
set "BWSTATUS=0"
for /f "usebackq delims=" %%s in (`powershell -NoProfile -Command "try { $h = Invoke-RestMethod -TimeoutSec 2 -Uri 'http://127.0.0.1:8073/healthz'; if ($h.ok -and $h.desktop) { '2' } elseif ($h.ok) { '1' } else { '0' } } catch { '0' }"`) do set "BWSTATUS=%%s"
exit /b 0

:sleep
powershell -NoProfile -Command "Start-Sleep -Milliseconds 500" >nul 2>nul
exit /b 0
