"use strict";
// A pretend eibispace.de: a small sample of the real B26 files (Latin-1, as EiBi publishes them).
// It answers for whatever season is asked, so the tests work all year; `missing` lists seasons to 404.
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "eibi");
const csv = fs.readFileSync(path.join(dir, "sked-b26.csv"));
const readme = fs.readFileSync(path.join(dir, "README.TXT"));

function eibiFile(url, missing = []) {
  const name = url.pathname.split("/").pop();
  if (name === "README.TXT") return readme;
  const m = /^sked-([ab]\d\d)\.csv$/.exec(name);
  if (!m || missing.includes(m[1].toUpperCase())) return undefined;
  return csv;
}

module.exports = { eibiFile };
