# Creates (or with -Remove, deletes) the HamShack by M0GLP & M3VRV shortcuts.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [ValidateSet("yes", "no")][string]$Startup = "no",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$name = "HamShack by M0GLP & M3VRV"
$desktop = [Environment]::GetFolderPath("Desktop")
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) $name
$startupDir = [Environment]::GetFolderPath("Startup")
# Shortcuts go through start-bandwatch.bat, which runs BandWatch.exe, or Node.js if Windows blocks the exe.
$start = Join-Path $InstallDir "start-bandwatch.bat"
$stop = Join-Path $InstallDir "stop-bandwatch.bat"
$icon = Join-Path $InstallDir "bandwatch.ico"
# ClearRX by M3VRV, the radio audio processor: a program of its own that comes with HamShack
$crxName = "ClearRX by M3VRV"
# (a separate download: unzipped into the ClearRX folder inside HamShack's, or next to BandWatch.exe)
$crxDir = Join-Path $InstallDir "ClearRX"
if (-not (Test-Path (Join-Path $crxDir "ClearRX.exe"))) { $crxDir = $InstallDir }
$crxExe = Join-Path $crxDir "ClearRX.exe"
$crxIcon = Join-Path $crxDir "clearrx.ico"
# Before 1.44 the app was called "Band Watch by M3vrv": remove its old shortcuts so there's only one set.
$oldName = "Band Watch by M3vrv"
$oldMenu = Join-Path ([Environment]::GetFolderPath("Programs")) $oldName
$oldStartup = Join-Path $startupDir "$oldName.lnk"
$hadOldStartup = Test-Path $oldStartup
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $desktop "$oldName.lnk"), $oldStartup
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $oldMenu

if ($Remove) {
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $desktop "$name.lnk"), (Join-Path $startupDir "$name.lnk"), (Join-Path $desktop "$crxName.lnk")
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $menu
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$description, [string]$iconFile = $icon, [int]$style = 7) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = $target
  $s.Arguments = $arguments
  $s.WorkingDirectory = $InstallDir
  $s.IconLocation = "$iconFile,0"
  $s.WindowStyle = $style   # 7 = minimised, so the launcher's window stays out of the way
  $s.Description = $description
  $s.Save()
}

New-Item -ItemType Directory -Force -Path $menu | Out-Null
New-Shortcut (Join-Path $desktop "$name.lnk") $start "" "Open HamShack by M0GLP & M3VRV"
New-Shortcut (Join-Path $menu "$name.lnk") $start "" "Open HamShack by M0GLP & M3VRV"
New-Shortcut (Join-Path $menu "Stop HamShack.lnk") $stop "" "Stop HamShack"
if (Test-Path $crxExe) {
  New-Shortcut (Join-Path $desktop "$crxName.lnk") $crxExe "" "Open ClearRX by M3VRV & King Coder, the radio audio processor" $crxIcon 1
  New-Shortcut (Join-Path $menu "$crxName.lnk") $crxExe "" "Open ClearRX by M3VRV & King Coder, the radio audio processor" $crxIcon 1
}
New-Shortcut (Join-Path $menu "Uninstall HamShack.lnk") (Join-Path $InstallDir "uninstall.bat") "" "Remove HamShack by M0GLP & M3VRV"

$startupLink = Join-Path $startupDir "$name.lnk"
if ($hadOldStartup) { $Startup = "yes" }   # it started with Windows under its old name: keep that
if ($Startup -eq "yes") { New-Shortcut $startupLink $start "--background" "Start HamShack by M0GLP & M3VRV in the background" }
else { Remove-Item -Force -ErrorAction SilentlyContinue $startupLink }
exit 0
