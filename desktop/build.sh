#!/bin/sh
# Builds Band Watch's Go server with the web page embedded.
#   sh desktop/build.sh        -> desktop/build/BandWatch.exe (Windows, with icon and version info)
#   sh desktop/build.sh test   -> desktop/build/bandwatch-test (this machine, for the test suite)
set -eu
cd "$(dirname "$0")"
VERSION=$(node -p 'require("../package.json").version')
node ../tools/stamp-build.js >/dev/null
BUILD_DATE=$(node -p 'require("../build-info.json").date')
rm -rf public && mkdir -p public build && cp -R ../public/. public/
LDFLAGS="-s -w -X main.version=$VERSION -X main.buildDate=$BUILD_DATE"

if [ "${1:-}" = "test" ]; then
  go build -trimpath -ldflags "$LDFLAGS" -o build/bandwatch-test .
  exit 0
fi

# Windows resources: icon and version details shown in Explorer's Properties window.
IFS=. read -r MA MI PA <<V
$VERSION
V
sed -e "s/@MA@/$MA/g; s/@MI@/$MI/g; s/@PA@/$PA/g; s/@VERSION@/$VERSION/g; s/@BUILD@/$BUILD_DATE/g" winres/bandwatch.rc.in > build/bandwatch.rc
cp ../windows/app/bandwatch.ico build/bandwatch.ico
llvm-rc /nologo /fo build/bandwatch.res build/bandwatch.rc
llvm-cvtres /nologo /machine:x64 /out:rsrc_windows_amd64.syso build/bandwatch.res
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$LDFLAGS -H windowsgui" -o build/BandWatch.exe .
rm -f rsrc_windows_amd64.syso
echo "Built build/BandWatch.exe $VERSION ($BUILD_DATE)"
