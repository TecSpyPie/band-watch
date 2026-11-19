# Windows app windows and combined installer

This folder holds two small Windows programs that sit around the normal Band Watch and ClearRX downloads.
Neither one changes Band Watch's or ClearRX's own code.

## app-window-src: real app windows

`BandWatchApp.exe` and `ClearRXApp.exe` show Band Watch (port 8073) and ClearRX (port 8074) in windows of
their own, using Microsoft WebView2, instead of Edge or Chrome `--app` windows.

- Each one starts the installed program's local server if it isn't running, and stops it again on close
  if it started it.
- Web serial (radio control), the microphone/sound input, pop-up windows (the Decodes window) and saved
  settings all work inside the window. Links to other sites (QRZ.com and so on) open in the normal browser.
- ClearRX always tries to open an Edge window when it starts. A tiny empty program (`Shim.cs`, built as
  `shim\Microsoft\Edge\Application\msedge.exe`) is given to it instead, so only the app window opens.
- Band Watch's "Install update" runs the normal setup, which points the icons back at the Edge version,
  removes the start-with-Windows shortcut and opens an Edge window. The Band Watch app window notices the
  server restart and puts the icons, the start-with-Windows shortcut and the uninstaller back, and closes
  that Edge window. (Built, not yet tested end to end.)
- `--selftest <file>` checks the features above inside the window and writes the results as JSON.

Build (Windows, no Visual Studio needed): put `Microsoft.Web.WebView2.Core.dll`,
`Microsoft.Web.WebView2.WinForms.dll` (from `lib/net462`) and `WebView2Loader.dll` (from
`runtimes/win-x64/native`) from the Microsoft.Web.WebView2 NuGet package (tested with 1.0.4314.35) in
`app-window-src\lib`, then run:

    powershell -ExecutionPolicy Bypass -File app-window-src\build.ps1

The programs go in `app-window-src\build`. Copy that folder's contents to `C:\BandWatch\App`.

## installer-src: one installer for both

`BandWatch-ClearRX-Setup-<version>.exe` carries `BandWatch-Setup-<version>.exe`, `ClearRX-Windows-<version>.zip`
and the app windows, installs all three for the current user, and points the desktop and Start menu icons
at the app windows. `/S` installs with no questions.

Put the release's `BandWatch-Setup-<version>.exe` and `ClearRX-Windows-<version>.zip` in `installer-parts`
next to this folder's parent, then run:

    powershell -ExecutionPolicy Bypass -File installer-src\build.ps1

**Not for release yet:** the installer isn't code signed, and Microsoft Defender's machine-learning check
flagged a build of it (`Trojan:Win32/Bearfoos.A!ml`), as it has some unsigned BandWatch-Setup downloads
(`Trojan:Win32/Wacatac.H!ml`). Sign it (SignPath) before offering it for download.
