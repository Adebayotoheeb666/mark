# Agent Mark mobile (Capacitor APK wrapper)

This folder wraps the **existing PWA companion** (`website/app/`) in a native Android shell with
Capacitor. It exists so GitHub Actions can produce an installable APK without an Android SDK on the
developer PC.

**What it is:** the same offline companion — encrypted score entry, flags, report-card preview, and an
explicit encrypted `.agmm` transfer to the desktop hub. The phone store is a passcode-protected
AES-256-GCM envelope in `localStorage`; it is not a second always-on database.

**What it is not:** a replacement for the desktop hub, a Play Store build, or a LAN/cloud sync client.
The native client waits for the hub LAN API. There is no account, no telemetry, and no network request
from the app.

## Real-data gate on the phone

Before a phone may hold real student data, the app requires:

1. A passcode of at least 8 characters (PBKDF2-SHA-256, 310,000 iterations, AES-256-GCM).
2. Auto-lock (5 minutes by default; the phone locks on background/visibility change).
3. An encrypted `.agmm` transfer export with a separate 12+ character transfer passphrase.
4. The privacy notice acknowledged and all demo rows cleared.
5. An explicit "enable real data" confirmation.

Wrong passcodes back off after five failures. "Wipe this phone" destroys the local encrypted store.
Losing the passcode loses the phone data; the encrypted export is the recovery path.

## Build (GitHub Actions)

The `android-apk` job in `.github/workflows/ci.yml` builds `app-debug.apk` and uploads it as the
`agent-mark-mobile-apk` artifact. The job:

1. `npm ci`
2. `npm run sync-web` — copies `website/app/` to `www/` (the PWA stays the single source of truth)
3. `npx cap add android` + `npx cap sync android`
4. `./gradlew assembleDebug` (or `assembleRelease` when signing secrets exist)
5. On a `v*` tag, `gh release create` attaches the APK to a public prerelease.

Download the Actions artifact from the workflow run (GitHub sign-in required; artifacts expire
after 90 days). The first verified run is
[40187821163](https://github.com/Adebayotoheeb666/mark/actions/runs/40187821163). It is installable
on Android 7+ with "Install unknown apps" allowed.

Tagged releases publish the same APK publicly; release assets do **not** require a GitHub login.
`v0.1.0` is at [releases/tag/v0.1.0](https://github.com/Adebayotoheeb666/mark/releases/tag/v0.1.0),
asset SHA-256 `2ca12fcd059fe6829bfbe8c05e11de6730897ec97b3c60b78ba801ea4b354780`. That asset is
debug-signed, predates the encrypted mobile store, and is **not** approved for real data. The
current mobile companion is the 0.2.0 PWA at `/app/`; pushing `v0.2.0` makes CI publish the matching
APK (debug-signed unless the keystore secrets are set).

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

The default CI APK is **debug-signed** — fine for a synthetic pilot, not for real data or a managed
fleet. To produce a release-signed APK, add these GitHub Actions secrets:

| Secret | Meaning |
|---|---|
| `AGM_ANDROID_KEYSTORE_BASE64` | Base64 of the release keystore (`.jks`) |
| `AGM_ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `AGM_ANDROID_KEY_ALIAS` | Key alias |
| `AGM_ANDROID_KEY_PASSWORD` | Key password |

When `AGM_ANDROID_KEYSTORE_BASE64` is set, CI decodes the keystore, patches the generated
`android/app/build.gradle` with a release `signingConfig`, and runs `assembleRelease`. The release
asset is named `Agent-Mark-Mobile-<version>.apk`; the debug fallback keeps the `-debug` suffix. Never
commit the keystore. Keep at least two sealed copies and record the SHA-256 of each release APK.

## Known limits

- `window.print()` is not implemented by the Android WebView, so the card's Print button is a
  no-op in the APK. Printing remains a desktop-hub feature.
- Blob downloads are routed through `@capacitor/filesystem` + `@capacitor/share`; if the native
  plugins are unavailable (plain browser), the app falls back to a normal download.
- The wrapper is the PWA, not the Rust hub: no roster sync, no Ed25519 signing, no backup/audit.
- The generated project uses Capacitor's default launcher icon and splash; custom Agent Mark
  icons are a follow-up.
- The PWA cache version is still manual (`website/app/sw.js`); bump it when the shell changes.
