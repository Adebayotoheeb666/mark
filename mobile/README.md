# Agent Mark mobile (Capacitor APK wrapper)

This folder wraps the **existing PWA companion** (`website/app/`) in a native Android shell with
Capacitor. It exists so GitHub Actions can produce an installable APK without an Android SDK on the
developer PC.

**What it is:** the same offline companion — score entry, flags, report-card preview, data in
`localStorage` on the phone. It does not sync with the desktop hub and is not a native Tauri client.

**What it is not:** a replacement for the desktop hub, a Play Store build (the CI artifact is
debug-signed), or a LAN sync client. The native client waits for the hub LAN API.

## Build (GitHub Actions)

The `android-apk` job in `.github/workflows/ci.yml` builds `app-debug.apk` and uploads it as the
`agent-mark-mobile-apk` artifact. The job:

1. `npm ci`
2. `npm run sync-web` — copies `website/app/` to `www/` (the PWA stays the single source of truth)
3. `npx cap add android` + `npx cap sync android`
4. `./gradlew assembleDebug`

Download the artifact from the workflow run; it is installable on Android 8+ with "Install unknown
apps" allowed.

## Build locally

Requires Node 22+, JDK 21, Android SDK (platform + build-tools) and `ANDROID_HOME` set.

```powershell
cd mobile
npm ci
npm run sync-web
npx cap add android
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

APK: `android\app\build\outputs\apk\debug\app-debug.apk`.

## Signing

The CI APK is **debug-signed** — fine for a pilot, not for Play Store or a managed fleet. For a
release build, add a keystore to GitHub Secrets and a `signingConfigs` block to the generated
`android/app/build.gradle`, then run `assembleRelease`. Never commit the keystore.

## Known limits

- `window.print()` is not implemented by the Android WebView, so the card's Print button is a
  no-op in the APK. Printing remains a desktop-hub feature.
- Blob downloads (`a.download`) may not work in a bare WebView; exporting the JSON needs
  `@capacitor/filesystem` + `@capacitor/share` (not wired yet).
- The wrapper is the PWA, not the Rust hub: no roster sync, no Ed25519 signing, no backup/audit.
- The PWA cache version is still manual (`website/app/sw.js`); bump it when the shell changes.
