#!/bin/sh
# Fetches rtl_tcp.exe and the three files it needs from the RTL-SDR Blog drivers for Windows
# (they support the RTL-SDR Blog V4), so the installer can put them next to BandWatch.exe and
# Listen > "My RTL-SDR" works straight away. The files are used exactly as released, unchanged.
#   sh tools/fetch-rtl-sdr.sh OUT_DIR
# rtl-sdr is GPL-2.0: its licence and where to get its source go in OUT_DIR too.
set -eu
OUT=${1:?usage: sh tools/fetch-rtl-sdr.sh OUT_DIR}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd)
cd "$(dirname "$0")/.."
RTL_TAG=V1.4.0
RTL_ZIP_URL="https://github.com/rtlsdrblog/rtl-sdr-blog/releases/download/$RTL_TAG/Release.zip"
# SHA-256 of that Release.zip. A changed or damaged download stops the build.
RTL_ZIP_SHA256=7ef33f1304647f65e5e0fde43637a73d54f076e91e651a3cecc4f55a17fd9815
FILES="rtl_tcp.exe rtlsdr.dll pthreadVC2.dll msvcr100.dll"

ok=1
for f in $FILES; do [ -f "$OUT/$f" ] || ok=0; done
if [ "$ok" = 1 ]; then echo "rtl-sdr files already in $OUT"; exit 0; fi

T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
curl -fsSL --retry 3 -o "$T/Release.zip" "$RTL_ZIP_URL"
echo "$RTL_ZIP_SHA256  $T/Release.zip" | sha256sum -c - >/dev/null || { echo "Release.zip checksum doesn't match: not using it"; exit 1; }
mkdir -p "$OUT"
for f in $FILES; do unzip -o -j -q "$T/Release.zip" "x64/$f" -d "$OUT"; done
cp windows/rtl-sdr/COPYING-rtl-sdr.txt windows/rtl-sdr/README-rtl-sdr.txt "$OUT/"
echo "rtl-sdr $RTL_TAG files in $OUT: $FILES"
