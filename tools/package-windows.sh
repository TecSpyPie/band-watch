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
cp desktop/build/BandWatch.exe windows/README-Windows.txt windows/install.bat "windows/Install HamShack (automatic).bat" "$W/"
cp desktop/build/payload/BUILD-INFO.txt LICENSE "$W/"
cp windows/app/* "$W/app/"
cp server.js qrz.js clock.js package.json build-info.json "$W/app/server/"
cp -R public "$W/app/server/public"
# rtl_tcp goes next to BandWatch.exe (install.bat copies app\ into C:\BandWatch)
sh tools/fetch-rtl-sdr.sh desktop/build/rtl-sdr
cp desktop/build/rtl-sdr/* "$W/app/"
mkdir -p dist
rm -f dist/BandWatch-Windows.zip
(cd "$T" && zip -qr -9 BandWatch-Windows.zip BandWatch-Windows)
mv "$T/BandWatch-Windows.zip" dist/
# ClearRX by M3VRV, its own download: unzip anywhere and run ClearRX.exe
[ -f clearrx/build/ClearRX.exe ] || sh clearrx/build.sh
C="$T/ClearRX"
mkdir -p "$C"
cp clearrx/build/ClearRX.exe clearrx/winres/clearrx.ico clearrx/README-ClearRX.txt LICENSE "$C/"
rm -f dist/ClearRX-Windows.zip
(cd "$T" && zip -qr -9 ClearRX-Windows.zip ClearRX)
mv "$T/ClearRX-Windows.zip" dist/
cp "desktop/build/BandWatch-Setup-$VERSION.exe" dist/
cp "desktop/build/BandWatch-Setup-$VERSION.exe" dist/BandWatch-Setup.exe
rm -rf "$T"
# The source of the rtl-sdr version included (GPL-2.0), attached to the release beside the binaries.
RTL_SRC=rtl-sdr-blog-V1.4.0-source.tar.gz
if ! curl -fsSL --retry 3 -o "dist/$RTL_SRC" "https://github.com/rtlsdrblog/rtl-sdr-blog/archive/refs/tags/V1.4.0.tar.gz"; then
  rm -f "dist/$RTL_SRC"
  if [ "${CI:-}" = true ]; then echo "Couldn't fetch the rtl-sdr source"; exit 1; fi
  echo "(rtl-sdr source not fetched: only needed for a release)"
fi
(cd dist && sha256sum BandWatch-Setup.exe "BandWatch-Setup-$VERSION.exe" BandWatch-Windows.zip ClearRX-Windows.zip > SHA256SUMS.txt)
ls -l dist
