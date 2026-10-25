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
5. On a `v*` tag, `gh release create` attaches the APK to a public prerelease.

Download the Actions artifact from the workflow run (GitHub sign-in required; artifacts expire
after 90 days). The first verified run is
[40187821163](https://github.com/Adebayotoheeb666/mark/actions/runs/40187821163). It is installable
on Android 7+ with "Install unknown apps" allowed.

Tagged releases publish the same APK publicly as
`Agent-Mark-Mobile-<version>-debug.apk`; release assets do **not** require a GitHub login. `v0.1.0`
is at [releases/tag/v0.1.0](https://github.com/Adebayotoheeb666/mark/releases/tag/v0.1.0), asset
SHA-256 `2ca12fcd059fe6829bfbe8c05e11de6730897ec97b3c60b78ba801ea4b354780`. The website's download
page links directly to that asset.

CI uses the runner's preinstalled Android SDK 36 and `actions/setup-java@v5` (Temurin 21); no
third-party Android setup action is needed.

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
- The generated project uses Capacitor's default launcher icon and splash; custom Agent Mark
  icons are a follow-up.
- The PWA cache version is still manual (`website/app/sw.js`); bump it when the shell changes.
