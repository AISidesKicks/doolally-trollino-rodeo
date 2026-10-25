#!/usr/bin/env node
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { ROOT } from "./config.js";

const SRC = path.join(ROOT, "src", "gui");
const OUT = path.join(ROOT, "gui");

function countFiles(dir) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = countFiles(full);
      files += nested.files;
      bytes += nested.bytes;
    } else {
      files += 1;
      bytes += statSync(full).size;
    }
  }
  return { files, bytes };
}

mkdirSync(OUT, { recursive: true });

for (const entry of readdirSync(OUT)) {
  if (entry === ".gitkeep") continue;
  rmSync(path.join(OUT, entry), { recursive: true, force: true });
}

cpSync(SRC, OUT, { recursive: true });

const stats = countFiles(OUT);
const kb = (stats.bytes / 1024).toFixed(1);
console.log(`GUI built into gui/: ${stats.files} files, ${kb} KB`);
console.log("Open it with: npm run server");
