# Builds the app windows into .\build with the C# compiler that comes with Windows.
$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$out = Join-Path $here "build"
$lib = Join-Path $here "lib"
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$shimDir = Join-Path $out "shim\Microsoft\Edge\Application"
New-Item -ItemType Directory -Force -Path $out, $shimDir | Out-Null

$common = @(
  "/nologo", "/target:winexe", "/optimize+", "/platform:x64",
  "/win32manifest:$here\app.manifest",
  "/reference:$lib\Microsoft.Web.WebView2.Core.dll",
  "/reference:$lib\Microsoft.Web.WebView2.WinForms.dll",
  "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
  "/reference:Microsoft.CSharp.dll", "/reference:System.Core.dll",
  "/resource:$here\selftest.js,selftest"
)

& $csc @common "/out:$out\BandWatchApp.exe" "/win32icon:$here\icons\bandwatch.ico" "$here\AppHost.cs"
if ($LASTEXITCODE -ne 0) { throw "Band Watch app failed to compile." }
& $csc @common "/define:CLEARRX" "/out:$out\ClearRXApp.exe" "/win32icon:$here\icons\clearrx.ico" "$here\AppHost.cs"
if ($LASTEXITCODE -ne 0) { throw "ClearRX app failed to compile." }
& $csc /nologo /target:winexe /optimize+ /platform:x64 "/out:$shimDir\msedge.exe" "$here\Shim.cs"
if ($LASTEXITCODE -ne 0) { throw "Shim failed to compile." }

Copy-Item "$lib\Microsoft.Web.WebView2.Core.dll", "$lib\Microsoft.Web.WebView2.WinForms.dll", "$lib\WebView2Loader.dll" -Destination $out -Force
Get-ChildItem -LiteralPath $out -File | Select-Object Name, Length
