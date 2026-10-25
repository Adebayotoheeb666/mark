#!/usr/bin/env node
/* Copy the canonical PWA shell from website/app into the Capacitor webDir.
 * website/app stays the single source of truth; nothing is edited twice. */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const src = path.resolve(root, "..", "website", "app");
const dest = path.join(root, "www");

fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log(`copied ${src} -> ${dest}`);
