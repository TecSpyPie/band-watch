#!/bin/sh
# Builds the Windows installer, BandWatch-Setup.exe, with the whole app inside it.
#   sh desktop/build-setup.sh   (after sh desktop/build.sh) -> desktop/build/BandWatch-Setup-<version>.exe
set -eu
cd "$(dirname "$0")"
VERSION=$(node -p 'require("../package.json").version')
[ -f build/BandWatch.exe ] || { echo "Run sh desktop/build.sh first"; exit 1; }
BUILD_DATE=$(node -p 'require("../build-info.json").date')

# The files exactly as they go in the install folder (%LOCALAPPDATA%\BandWatch).
P=build/payload
rm -rf "$P" && mkdir -p "$P/server"
cp build/BandWatch.exe ../windows/README-Windows.txt ../LICENSE "$P/"
# ClearRX by M3VRV is a separate download (ClearRX-Windows.zip), so a virus checker's false alarm on it
# can't stop HamShack installing.
cp ../windows/app/* "$P/"
cp ../server.js ../qrz.js ../clock.js ../package.json ../build-info.json "$P/server/"
printf 'HamShack by M0GLP & M3VRV\r\nVersion %s\r\nBuilt %s\r\n' "$VERSION" "$BUILD_DATE" > "$P/BUILD-INFO.txt"
cp -R ../public "$P/server/public"
# rtl_tcp and what it needs, next to BandWatch.exe, so Listen > "My RTL-SDR" works straight away.
sh ../tools/fetch-rtl-sdr.sh build/rtl-sdr
cp build/rtl-sdr/* "$P/"
rm -f setup/payload.zip
(cd "$P" && zip -qr -9 ../../setup/payload.zip .)

IFS=. read -r MA MI PA <<V
$VERSION
V
sed -e "s/@MA@/$MA/g; s/@MI@/$MI/g; s/@PA@/$PA/g; s/@VERSION@/$VERSION/g; s/@BUILD@/$BUILD_DATE/g" setup/winres/setup.rc.in > build/setup.rc
cp ../windows/app/bandwatch.ico build/bandwatch.ico
cp setup/winres/setup.manifest build/setup.manifest
llvm-rc /nologo /fo build/setup.res build/setup.rc
llvm-cvtres /nologo /machine:x64 /out:setup/rsrc_windows_amd64.syso build/setup.res
(cd setup && GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -X main.version=$VERSION -X main.buildDate=$BUILD_DATE -H windowsgui" -o "../build/BandWatch-Setup-$VERSION.exe" .)
rm -f setup/rsrc_windows_amd64.syso
echo "Built build/BandWatch-Setup-$VERSION.exe ($BUILD_DATE)"
