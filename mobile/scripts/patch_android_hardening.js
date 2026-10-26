#!/usr/bin/env node
/* Harden the Capacitor Android companion shell before any build:
 *  - android:allowBackup="false" + android:fullBackupContent="false" (no device/cloud backup of the
 *    encrypted local store)
 *  - FLAG_SECURE (no screenshots / screen recording of the app window)
 * CI runs this unconditionally before the debug/release APK builds. The release signing config itself
 * is applied by scripts/configure-android-signing.js when the keystore secret is set.
 */
const fs = require("node:fs");
const path = require("node:path");

const manifest = path.resolve(__dirname, "..", "android", "app", "src", "main", "AndroidManifest.xml");
if (!fs.existsSync(manifest)) {
  console.error(`Not found: ${manifest}. Run "npx cap add android" first.`);
  process.exit(1);
}
let mf = fs.readFileSync(manifest, "utf8");
let changed = false;
if (mf.includes('android:allowBackup="true"')) {
  mf = mf.replace('android:allowBackup="true"', 'android:allowBackup="false"');
  changed = true;
}
if (!mf.includes("android:fullBackupContent")) {
  mf = mf.replace('android:allowBackup="false"', 'android:allowBackup="false"\n        android:fullBackupContent="false"');
  changed = true;
}
fs.writeFileSync(manifest, mf);
console.log(`Patched ${manifest}`);

const main = path.resolve(
  __dirname,
  "..",
  "android",
  "app",
  "src",
  "main",
  "java",
  "org",
  "agentmark",
  "companion",
  "MainActivity.java"
);
if (!fs.existsSync(main)) {
  console.error(`Not found: ${main}. Run "npx cap add android" first.`);
  process.exit(1);
}
let src = fs.readFileSync(main, "utf8");
if (!src.includes("FLAG_SECURE")) {
  if (!src.includes("import android.view.WindowManager;")) {
    src = src.replace(
      /public class MainActivity extends BridgeActivity \{/,
      `import android.view.WindowManager;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}`
    );
  } else {
    src = src.replace(
      /public class MainActivity extends BridgeActivity \{/,
      `public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }
}`
    );
  }
}
fs.writeFileSync(main, src);
console.log(`Patched ${main}`);
