@echo off
setlocal EnableExtensions
title Band Watch by M3VRV ^& King Coder - Installer
cd /d "%~dp0"

rem "install.bat /auto" installs answering every question with its default.
set "AUTO="
if /i "%~1"=="/auto" set "AUTO=1"

set "SRC=%~dp0"
rem Band Watch goes in C:\BandWatch (the Windows drive), the same place as BandWatch-Setup.exe puts it.
if "%SystemDrive%"=="" (set "DEST=C:\BandWatch") else (set "DEST=%SystemDrive%\BandWatch")
set "OLD=%LOCALAPPDATA%\BandWatch"

echo.
echo   Band Watch by M3VRV ^& King Coder - Windows installer
echo   ========================================
echo.

if not exist "%SRC%BandWatch.exe" (
  echo   BandWatch.exe was not found next to this installer.
  echo   Unzip the whole download first, then run install.bat from the unzipped folder.
  goto :fail
)

rem ---------- Stop a copy that is already running (any version) ----------
call "%SRC%app\stop-bandwatch.bat" quiet
if exist "%DEST%\ClearRX.exe" "%DEST%\ClearRX.exe" --stop >nul 2>nul
if exist "%DEST%\ClearRX\ClearRX.exe" "%DEST%\ClearRX\ClearRX.exe" --stop >nul 2>nul

rem ---------- Copy the app ----------
echo   Installing to %DEST%
if not exist "%DEST%" mkdir "%DEST%" 2>nul
if not exist "%DEST%" (
  echo   %DEST% couldn't be created, so Band Watch goes in %OLD% instead.
  set "DEST=%OLD%"
  if not exist "%OLD%" mkdir "%OLD%"
)
copy /y "%SRC%BandWatch.exe" "%DEST%\" >nul || goto :copyfail
if exist "%SRC%BUILD-INFO.txt" copy /y "%SRC%BUILD-INFO.txt" "%DEST%\" >nul
if exist "%SRC%README-Windows.txt" copy /y "%SRC%README-Windows.txt" "%DEST%\" >nul
robocopy "%SRC%app" "%DEST%" /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 >nul
if errorlevel 8 goto :copyfail

rem ---------- Tidy away files from older versions (the Node.js copy now lives in "server") ----------
for %%f in (server.js qrz.js clock.js package.json bandwatch-status.ps1) do if exist "%DEST%\%%f" del /q "%DEST%\%%f"
if exist "%DEST%\public" rmdir /s /q "%DEST%\public"

rem ---------- An older copy in %LOCALAPPDATA%\BandWatch (installed by earlier versions) ----------
if /i not "%DEST%"=="%OLD%" if exist "%OLD%" (
  if exist "%OLD%\BandWatch.exe" (
    echo.
    call :ask "Remove the older copy of Band Watch in %OLD% (your settings are kept)" Y
    if not errorlevel 2 rmdir /s /q "%OLD%"
  ) else (
    rmdir /s /q "%OLD%" 2>nul
  )
)

rem ---------- List Band Watch in Settings, Apps, so it can be uninstalled from there ----------
set "UKEY=HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\BandWatchM3vrv"
reg add "%UKEY%" /v DisplayName /t REG_SZ /d "Band Watch by M3VRV ^& King Coder" /f >nul 2>nul
reg add "%UKEY%" /v Publisher /t REG_SZ /d "M3VRV ^& King Coder" /f >nul 2>nul
reg add "%UKEY%" /v DisplayIcon /t REG_SZ /d "%DEST%\bandwatch.ico" /f >nul 2>nul
reg add "%UKEY%" /v InstallLocation /t REG_SZ /d "%DEST%" /f >nul 2>nul
reg add "%UKEY%" /v UninstallString /t REG_SZ /d "\"%DEST%\uninstall.bat\"" /f >nul 2>nul
reg add "%UKEY%" /v NoModify /t REG_DWORD /d 1 /f >nul 2>nul
reg add "%UKEY%" /v NoRepair /t REG_DWORD /d 1 /f >nul 2>nul
if exist "%SRC%BUILD-INFO.txt" for /f "tokens=2" %%x in ('findstr /b "Version" "%SRC%BUILD-INFO.txt"') do reg add "%UKEY%" /v DisplayVersion /t REG_SZ /d %%x /f >nul 2>nul

rem ---------- Clear the "downloaded from the internet" mark from Band Watch's own files ----------
rem Windows marks every file that came in a download. Unblocking them here (the same as ticking
rem "Unblock" in a file's Properties) stops Windows asking about each Band Watch file again.
rem It changes nothing else on this PC.
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%DEST%' -Recurse -File | Unblock-File" >nul 2>nul

rem ---------- Smart App Control ----------
call :sacheck

rem ---------- Shortcuts ----------
set "STARTUP=no"
echo.
call :ask "Start Band Watch automatically when Windows starts" N
if not errorlevel 2 set "STARTUP=yes"

powershell -NoProfile -ExecutionPolicy Bypass -File "%DEST%\make-shortcuts.ps1" -InstallDir "%DEST%" -Startup %STARTUP%
if errorlevel 1 echo   Shortcuts could not be created. You can still run "%DEST%\start-bandwatch.bat".

echo.
echo   Done. Band Watch by M3VRV ^& King Coder is installed.
echo   Use the "Band Watch by M3vrv" shortcut on your desktop or in the Start menu.
echo   It opens at http://localhost:8073 in your web browser.
echo.
call :ask "Open Band Watch now" Y
if not errorlevel 2 start "" /min "%DEST%\start-bandwatch.bat"
echo.
call :finish
exit /b 0

:copyfail
echo   Copying the files failed.
goto :fail

:fail
echo.
echo   Installation did not finish.
call :finish
exit /b 1

rem ---------- Smart App Control: Windows blocks programs without a paid signing certificate ----------
rem Reads the setting only; it is the PC owner's to change, in Windows Security.
:sacheck
set "SAC=0"
for /f "tokens=3" %%v in ('reg query "HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy" /v VerifiedAndReputablePolicyState 2^>nul ^| find "0x"') do set /a "SAC=%%v"
if not "%SAC%"=="1" exit /b 0
set "NODE="
where node >nul 2>nul && set "NODE=1"
if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=1"
echo.
echo   ------------------------------------------------------------------
echo   Smart App Control is ON on this PC.
echo   It blocks BandWatch.exe, because the exe isn't signed with a paid
echo   code-signing certificate. Windows gives no "Run anyway" for it.
echo.
echo   Band Watch can still run: the shortcuts start it with Node.js
echo   instead (Node.js is signed, so Windows allows it).
if defined NODE (
  echo   Node.js is installed, so Band Watch will work as it is.
  echo   ------------------------------------------------------------------
  exit /b 0
)
echo   Node.js isn't installed yet.
echo   ------------------------------------------------------------------
echo.
echo     1  Install Node.js now (free, from nodejs.org, using winget)
echo     2  Open Windows Security, so you can turn Smart App Control off yourself
echo     3  Skip for now
echo.
if defined AUTO (
  echo   Skipped [automatic]. Install Node.js LTS from https://nodejs.org to run Band Watch.
  exit /b 0
)
choice /C 123 /N /M "  Type 1, 2 or 3: "
if errorlevel 3 exit /b 0
if errorlevel 2 goto :sacopen
where winget >nul 2>nul
if errorlevel 1 (
  echo   winget isn't available, so the Node.js download page will open instead.
  echo   Install the LTS version, then open Band Watch.
  start "" "https://nodejs.org/en/download"
  exit /b 0
)
winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
if errorlevel 1 (
  echo   Node.js didn't install. The download page will open instead.
  start "" "https://nodejs.org/en/download"
)
exit /b 0
:sacopen
echo.
echo   In Windows Security, open "Smart App Control settings" and choose Off.
echo   That lets every unsigned program run on this PC, not only Band Watch.
echo   On Windows 11 25H2 and later you can turn it back on there; on older
echo   versions it can only be turned back on by resetting Windows.
start "" "windowsdefender://appbrowser"
echo.
pause
exit /b 0

rem ---------- Ask Y/N, or use the default in /auto mode. Errorlevel 1 = Yes, 2 = No ----------
:ask
if not defined AUTO goto :askUser
echo   %~1? %~2 [automatic]
if /i "%~2"=="Y" exit /b 1
exit /b 2
:askUser
choice /C YN /M "  %~1"
exit /b %errorlevel%

rem ---------- Keep the window open so the result can be read ----------
:finish
if defined AUTO (
  echo   This window closes in 30 seconds.
  timeout /t 30 >nul
) else (
  pause
)
exit /b 0
