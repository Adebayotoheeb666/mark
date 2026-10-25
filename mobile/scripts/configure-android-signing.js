#!/usr/bin/env node
/* Add a release signingConfig to the Capacitor-generated Android project.
 * CI runs this only when AGM_ANDROID_KEYSTORE_BASE64 is configured. The keystore
 * itself is decoded to android/app/release.keystore and is never committed. */
const fs = require("node:fs");
const path = require("node:path");

const gradle = path.resolve(__dirname, "..", "android", "app", "build.gradle");
if (!fs.existsSync(gradle)) {
  console.error(`Not found: ${gradle}. Run "npx cap add android" first.`);
  process.exit(1);
}
let src = fs.readFileSync(gradle, "utf8");
const hasReleaseSigning = /signingConfigs\s*\{[\s\S]*?release\s*\{/.test(src);
if (!hasReleaseSigning) {
  const releaseBlock = `release {
            storeFile file(System.getenv("AGM_KEYSTORE_PATH") ?: "release.keystore")
            storePassword System.getenv("AGM_KEYSTORE_PASSWORD")
            keyAlias System.getenv("AGM_KEY_ALIAS")
            keyPassword System.getenv("AGM_KEY_PASSWORD")
        }`;
  if (!src.includes("signingConfigs")) {
    src = src.replace(
      /android\s*\{/,
      `android {
    signingConfigs {
        ${releaseBlock}
    }`
    );
  } else {
    src = src.replace(
      /signingConfigs\s*\{/,
      `signingConfigs {
        ${releaseBlock}`
    );
  }
}
if (!src.includes("signingConfig signingConfigs.release")) {
  const before = src;
  src = src.replace(
    /buildTypes\s*\{([\s\S]*?)release\s*\{/,
    (match, prefix) => `buildTypes {${prefix}release {\n            signingConfig signingConfigs.release`
  );
  if (src === before) {
    console.error("Could not find a release buildType in build.gradle.");
    process.exit(1);
  }
}
// Capacitor templates sometimes pin the release build to the debug key. Replace
// that line so our signingConfig actually wins.
src = src.replace(/signingConfig\s+signingConfigs\.debug/g, "signingConfig signingConfigs.release");
fs.writeFileSync(gradle, src);
console.log(`Patched ${gradle}`);
