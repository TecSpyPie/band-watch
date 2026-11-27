# Builds BandWatch-ClearRX-Setup-<version>.exe with the C# compiler that comes with Windows.
# Usage: powershell -ExecutionPolicy Bypass -File build.ps1 [-BandWatchSetup <exe>] [-ClearRXZip <zip>] [-ClearRXVersion 1.1.0]
param(
  [string]$BandWatchSetup = "$PSScriptRoot\..\installer-parts\BandWatch-Setup-1.25.0.exe",
  [string]$ClearRXZip = "$PSScriptRoot\..\installer-parts\ClearRX-Windows-1.1.0.zip",
  [string]$ClearRXVersion = "1.1.0",
  [string]$Icon = "C:\BandWatch\bandwatch.ico"
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$fx = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"

foreach ($f in $csc, $BandWatchSetup, $ClearRXZip, $Icon) {
  if (-not (Test-Path -LiteralPath $f)) { throw "Not found: $f" }
}

$bwVersion = (Get-Item -LiteralPath $BandWatchSetup).VersionInfo.ProductVersion.Trim()
$out = Join-Path (Split-Path -Parent $here) "BandWatch-ClearRX-Setup-$bwVersion.exe"

$gen = Join-Path $env:TEMP ("bundle-version-" + [guid]::NewGuid().ToString("N") + ".cs")
@"
using System.Reflection;
[assembly: AssemblyTitle("HamShack and ClearRX Setup")]
[assembly: AssemblyProduct("HamShack by M0GLP & M3VRV")]
[assembly: AssemblyCompany("M3vrv")]
[assembly: AssemblyFileVersion("$bwVersion")]
[assembly: AssemblyInformationalVersion("$bwVersion")]
static class BundleVersion {
  public const string BandWatch = "$bwVersion";
  public const string ClearRX = "$ClearRXVersion";
}
"@ | Set-Content -LiteralPath $gen -Encoding UTF8

# The real app windows go inside the installer as a zip.
$appSrc = Join-Path (Split-Path -Parent $here) "app-window-src"
powershell -NoProfile -ExecutionPolicy Bypass -File "$appSrc\build.ps1" | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The app windows failed to build." }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$appZip = Join-Path $env:TEMP ("bundle-apps-" + [guid]::NewGuid().ToString("N") + ".zip")
[IO.Compression.ZipFile]::CreateFromDirectory("$appSrc\build", $appZip)

try {
  & $csc /nologo /target:winexe /optimize+ /platform:anycpu "/out:$out" `
    "/resource:$appZip,AppWindowsZip" "/resource:$here\retarget-shortcuts.ps1,RetargetShortcuts" `
    "/win32manifest:$here\app.manifest" "/win32icon:$Icon" `
    "/reference:$fx\System.IO.Compression.dll" `
    "/reference:System.Windows.Forms.dll" "/reference:System.Drawing.dll" `
    "/resource:$BandWatchSetup,BandWatchSetup" "/resource:$ClearRXZip,ClearRXZip" `
    "$here\BundleSetup.cs" $gen
  if ($LASTEXITCODE -ne 0) { throw "The compiler reported errors." }
} finally {
  Remove-Item -LiteralPath $gen, $appZip -Force -ErrorAction SilentlyContinue
}

$item = Get-Item -LiteralPath $out
"Built $($item.FullName) ($([math]::Round($item.Length / 1MB, 1)) MB)"
"SHA256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash)"
