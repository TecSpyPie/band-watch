#!/usr/bin/env node
// Writes build-info.json: the version and the date and time of this build (UTC).
// Run by desktop/build.sh; the Node server and the installer read it.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const { version } = require(path.join(root, "package.json"));
const date = process.env.BW_BUILD_DATE || new Date().toISOString().replace(/\.\d+Z$/, "Z");
const info = { version, date };
fs.writeFileSync(path.join(root, "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`build ${version} ${date}`);
