#!/bin/sh
# Builds ClearRX by M3VRV. It shares its sound engine (rxfx.js) with Band Watch, so that's copied in first.
#   sh clearrx/build.sh        -> clearrx/build/ClearRX.exe (Windows, with icon and version info)
#   sh clearrx/build.sh test   -> clearrx/build/clearrx-test (this machine, for the tests)
set -eu
cd "$(dirname "$0")"
VERSION=$(cat VERSION)
BUILD_DATE=$(date -u +%Y-%m-%d)
mkdir -p build public/js
cp ../public/js/rxfx.js public/js/rxfx.js
LDFLAGS="-s -w -X main.version=$VERSION -X main.buildDate=$BUILD_DATE"

if [ "${1:-}" = "test" ]; then
  go build -trimpath -ldflags "$LDFLAGS" -o build/clearrx-test .
  exit 0
fi

IFS=. read -r MA MI PA <<V
$VERSION
V
sed -e "s/@MA@/$MA/g; s/@MI@/$MI/g; s/@PA@/$PA/g; s/@VERSION@/$VERSION/g; s/@BUILD@/$BUILD_DATE/g" winres/clearrx.rc.in > build/clearrx.rc
cp winres/clearrx.ico build/clearrx.ico
llvm-rc /nologo /fo build/clearrx.res build/clearrx.rc
llvm-cvtres /nologo /machine:x64 /out:rsrc_windows_amd64.syso build/clearrx.res
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS -H windowsgui" -o build/ClearRX.exe .
rm -f rsrc_windows_amd64.syso
echo "Built build/ClearRX.exe $VERSION ($BUILD_DATE)"
