#!/bin/sh
# Packs the Windows download after sh desktop/build.sh and sh desktop/build-setup.sh:
#   dist/BandWatch-Windows.zip       (BandWatch.exe, install.bat and the Node.js copy)
#   dist/BandWatch-Setup.exe         (the one-file installer)
#   dist/BandWatch-Setup-<ver>.exe   (the same, named with its version)
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p 'require("./package.json").version')
[ -f desktop/build/BandWatch.exe ] && [ -f "desktop/build/BandWatch-Setup-$VERSION.exe" ] || { echo "Build first: sh desktop/build.sh && sh desktop/build-setup.sh"; exit 1; }
T=$(mktemp -d)
W="$T/BandWatch-Windows"
mkdir -p "$W/app/server"
cp desktop/build/BandWatch.exe windows/README-Windows.txt windows/install.bat "windows/Install Band Watch (automatic).bat" "$W/"
cp desktop/build/payload/BUILD-INFO.txt LICENSE "$W/"
cp windows/app/* "$W/app/"
cp server.js qrz.js clock.js package.json build-info.json "$W/app/server/"
cp -R public "$W/app/server/public"
mkdir -p dist
rm -f dist/BandWatch-Windows.zip
(cd "$T" && zip -qr -9 BandWatch-Windows.zip BandWatch-Windows)
mv "$T/BandWatch-Windows.zip" dist/
cp "desktop/build/BandWatch-Setup-$VERSION.exe" dist/
cp "desktop/build/BandWatch-Setup-$VERSION.exe" dist/BandWatch-Setup.exe
rm -rf "$T"
(cd dist && sha256sum BandWatch-Setup.exe "BandWatch-Setup-$VERSION.exe" BandWatch-Windows.zip > SHA256SUMS.txt)
ls -l dist
