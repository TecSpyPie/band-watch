# Creates (or with -Remove, deletes) the Band Watch by M3vrv shortcuts.
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [ValidateSet("yes", "no")][string]$Startup = "no",
  [switch]$Remove
)
$ErrorActionPreference = "Stop"
$name = "Band Watch by M3vrv"
$desktop = [Environment]::GetFolderPath("Desktop")
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) $name
$startupDir = [Environment]::GetFolderPath("Startup")
# Shortcuts go through start-bandwatch.bat, which runs BandWatch.exe, or Node.js if Windows blocks the exe.
$start = Join-Path $InstallDir "start-bandwatch.bat"
$stop = Join-Path $InstallDir "stop-bandwatch.bat"
$icon = Join-Path $InstallDir "bandwatch.ico"

if ($Remove) {
  Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $desktop "$name.lnk"), (Join-Path $startupDir "$name.lnk")
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $menu
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
function New-Shortcut([string]$path, [string]$target, [string]$arguments, [string]$description) {
  $s = $shell.CreateShortcut($path)
  $s.TargetPath = $target
  $s.Arguments = $arguments
  $s.WorkingDirectory = $InstallDir
  $s.IconLocation = "$icon,0"
  $s.WindowStyle = 7   # minimised, so the launcher's window stays out of the way
  $s.Description = $description
  $s.Save()
}

New-Item -ItemType Directory -Force -Path $menu | Out-Null
New-Shortcut (Join-Path $desktop "$name.lnk") $start "" "Open Band Watch by M3vrv"
New-Shortcut (Join-Path $menu "$name.lnk") $start "" "Open Band Watch by M3vrv"
New-Shortcut (Join-Path $menu "Stop Band Watch.lnk") $stop "" "Stop Band Watch"
New-Shortcut (Join-Path $menu "Uninstall Band Watch.lnk") (Join-Path $InstallDir "uninstall.bat") "" "Remove Band Watch by M3vrv"

$startupLink = Join-Path $startupDir "$name.lnk"
if ($Startup -eq "yes") { New-Shortcut $startupLink $start "--background" "Start Band Watch by M3vrv in the background" }
else { Remove-Item -Force -ErrorAction SilentlyContinue $startupLink }
exit 0
