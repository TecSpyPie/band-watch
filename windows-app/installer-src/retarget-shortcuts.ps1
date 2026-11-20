# Points the Band Watch and ClearRX shortcuts at their real app windows.
param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = "Stop"
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath("Desktop")
$menu = Join-Path ([Environment]::GetFolderPath("Programs")) "Band Watch by M3vrv"
$appDir = Join-Path $InstallDir "App"

function Set-AppLink([string]$path, [string]$target, [string]$icon, [string]$description) {
  $link = $shell.CreateShortcut($path)
  $link.TargetPath = $target
  $link.Arguments = ""
  $link.WorkingDirectory = $appDir
  $link.IconLocation = "$icon,0"
  $link.WindowStyle = 1
  $link.Description = $description
  $link.Save()
}

New-Item -ItemType Directory -Force -Path $menu | Out-Null
foreach ($folder in $desktop, $menu) {
  Set-AppLink (Join-Path $folder "Band Watch by M3vrv.lnk") (Join-Path $appDir "BandWatchApp.exe") (Join-Path $InstallDir "bandwatch.ico") "Open Band Watch by M3vrv"
  Set-AppLink (Join-Path $folder "ClearRX by M3VRV.lnk") (Join-Path $appDir "ClearRXApp.exe") (Join-Path $InstallDir "ClearRX\clearrx.ico") "Open ClearRX by M3VRV, the radio audio processor"
}
exit 0
