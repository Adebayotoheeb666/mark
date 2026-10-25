# Phase 10 — Distribution: desktop installer, mobile app, Vercel site

Status: **built and verified on this machine** (Windows 11, GNU Rust toolchain + Zig shims).
Date: 2026-10-25 · Version: **0.1.0 (pilot)**

This phase turns the Hub source into three things a school can actually get hold of:

| Artifact | Where | Size | Status |
|---|---|---|---|
| Windows installer (NSIS, per-user) | `website/downloads/Agent-Mark-Hub-0.1.0-x64-setup.exe` | 6,081,397 B (5.80 MB) | install → run → E2E → uninstall verified |
| Windows MSI (per-machine) | `website/downloads/Agent-Mark-Hub-0.1.0-x64.msi` | 8,245,248 B (7.86 MB) | WiX build + administrative extract verified |
| Portable ZIP | `website/downloads/Agent-Mark-Hub-0.1.0-windows-x64-portable.zip` | 6,054,793 B (5.77 MB) | contains exe + `WebView2Loader.dll` + README |
| Mobile app (installable PWA) | `website/app/` | ~90 KB shell | score entry, flags, card preview; offline shell verified |
| Download website (Vercel) | `website/` | static, no build step | all pages 200, no broken links, hashes hydrated from `version.json` |

The site is deliberately **static**: no framework, no build command, no serverless functions,
no analytics, no third-party fonts. Deploy it by pointing Vercel at the `website/` directory.

---

## 1. Desktop packaging

### What changed in the app

- `src-tauri/tauri.conf.json` now configures a real bundle:
  - `bundle.targets = ["nsis", "msi"]` — NSIS for per-user installs, WiX MSI for managed fleets
  - `bundle.windows.wix.upgradeCode` is pinned (`27dcc818-5185-51ae-84a1-da0dea51df8c`) so an MSI
    upgrade replaces the previous version instead of installing side by side
  - `bundle.icon = ["icons/icon.ico"]`
  - `installMode = "currentUser"` — **no administrator password** on school PCs
  - `webviewInstallMode = embedBootstrapper` — the WebView2 bootstrapper travels inside the
    installer, so a PC that has never run Edge can still install offline-ish (runtime itself is
    fetched from Microsoft only if missing)
  - publisher/copyright/description metadata so the uninstaller and Apps list look sane
- `report_html` was rewritten with a printable A4 stylesheet (serif school header, ruled table,
  signature block, verification footer). It now prints the student's **name** (added to the
  draft payload) and the school name from `meta.school_name`.
- Two commands added: `school_get` / `school_set` (school name on the report card, audited).
- Dashboard: state-coloured counters, school-name editor, clearer action row.
- Demo roster now has plausible surnames (Ada Okafor … Funmi Lawal) instead of "Ada Demo".

### How the installer was produced

```powershell
cd hub-desktop
$env:PATH = "$PWD\tools\bin;$env:PATH"
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
tauri build --bundles nsis,msi
```

The Tauri CLI (v2.12.4) downloads NSIS 3.13, `nsis_tauri_utils.dll` and WiX 3.14 from GitHub on
first use, verifies their SHA-256, and caches them under `%LOCALAPPDATA%\tauri`. No MSVC is needed
on this machine; the GNU-built exe is packaged by both bundlers.

Outputs:

- `src-tauri/target/release/bundle/nsis/Agent Mark Hub_0.1.0_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Agent Mark Hub_0.1.0_x64_en-US.msi`

### Installer test (not just a compile)

1. `Agent-Mark-Hub-0.1.0-x64-setup.exe /S` → exit code 0.
2. Installed files: `%LOCALAPPDATA%\Agent Mark Hub\{agent-mark-hub.exe, uninstall.exe, WebView2Loader.dll}`.
3. Launched the **installed** exe with an isolated `AGM_DATA_DIR` and ran the full CDP E2E:
   6 students, 25 scores, 5 flags, 5 drafts, teacher review, head approval, lock + Ed25519
   signature, HTML without the DRAFT banner, 95-char comment, backup, drill, `go_live` → LIVE,
   35 audit rows. `verify_db.py` → `RESULT: PASS`.
4. `uninstall.exe /S` → exit 0; install directory, Start-menu shortcut and desktop shortcut all gone.

### MSI (managed deployment)

`msiexec /a "Agent Mark Hub_0.1.0_x64_en-US.msi" /qn TARGETDIR=...` extracted the package to
`PFiles\Agent Mark Hub\{agent-mark-hub.exe, WebView2Loader.dll}` and exited 0, so the WiX database
and payload are valid. The MSI is **per-machine** (`ALLUSERS=1`) and needs administrator rights;
the NSIS installer remains the no-admin option. Silent install for GPO/Intune/SCCM:

```powershell
msiexec /i Agent-Mark-Hub-0.1.0-x64.msi /qn
```

The package is unsigned, so SmartScreen/AppLocker policy applies exactly as for the `.exe`.

### Portable ZIP

`agent-mark-hub.exe` **plus `WebView2Loader.dll`** (the exe imports it; the ZIP is broken without
it) and a `README.txt` that names the data path and the pilot restriction.

---

## 2. Website (Vercel)

```
website/
  index.html          landing: what it is, no-AI/offline/privacy, screenshots
  download.html       installer, portable ZIP, mobile app, live checksums
  install.html        install → first ten minutes → uninstall → troubleshooting
  privacy.html        data locations, sealing, verification, the pilot gate
  404.html
  app/                the installable mobile companion (PWA)
  assets/             CSS, JS, logo, OG image, real screenshots (captured over CDP)
  downloads/          the two Windows artifacts + SHA256SUMS.txt
  version.json        machine-readable release manifest (sizes + SHA-256)
  vercel.json         security headers, cache policy, manifest MIME type
  robots.txt, sitemap.xml
```

- **No build step.** Framework preset "Other", root directory `website`, no build command,
  output directory `.`.
- `download.html` reads `version.json` at runtime and fills every size, full hash, short hash and
  copy button. A new release therefore needs **no HTML edits** — replace the files, run
  `scripts/stamp_release.py`, deploy.
- Security headers include a strict CSP (`script-src 'self'`, `frame-ancestors 'none'`),
  `nosniff`, `Referrer-Policy`, and a permissions policy that denies camera/mic/geolocation.
- The site sets no cookies, loads nothing from third parties, and has no analytics.

### Verification performed

- Every local `href`/`src` resolved on disk (no broken links across the five pages + app).
- Every page, the manifest, the service worker, `version.json`, the OG image and the 5.8 MB
  installer returned HTTP 200 from `python -m http.server`.
- `version.json`, `vercel.json` and `manifest.webmanifest` parse as JSON; `app.js`, `sw.js` and
  `site.js` pass `node --check`.
- Download page hydration checked in a real browser: displayed hashes/sizes match the files and
  `version.json`; the copy button carries the full hash.
- **Lighthouse (Chrome, 800 px viewport): accessibility 100, best practices 100, SEO 100** on all
  five pages and the mobile app. Fixes made from the audit: darkened `--muted` to reach 4.5:1,
  footer headings `h4` → `h3` (no skipped levels), a visually hidden `<h2>Downloads</h2>` above the
  three download cards, and removed the 75 % opacity on the mock "verified" stamp.

---

## 3. Mobile app

### What it is

An **installable Progressive Web App** at `/app/`:

- Home (readiness, counts), Scores (range + duplicate + missing rules), Flags (tap to jump to the
  missing mark), Card (computed averages, grades, competition position, print), More
  (export/import JSON, reset, links).
- Same arithmetic as the desktop: weights 20/20/60 (MATHS) and 40/60 (ENG), round-half-up to
  tenths, grade bands A ≥70, B ≥60, C ≥50, D ≥45, E ≥40, else F, competition rank "1224".
- `localStorage` only. No `fetch` for data, no account, no sync, no analytics. The app is a
  **companion preview**: the authoritative hub stays on the school PC, and the phone cannot
  approve or sign a report.
- Service worker caches the shell (`agentmark-app-v4`); a manifest with 192/512/maskable icons and
  an Apple touch icon makes it installable from Chrome/Safari without a store.

### Verification performed (headless browser)

- Initial state: 6 students, 0 marks, 30 missing.
- Entered MATHS 17/15/50 → live average **82.0 · A**; save reported 3 marks.
- Entered 99 in CA1 → refused with `VAL-RANGE-01: CA1 must be between 0 and 20`.
- Re-saving an unchanged mark → "Nothing to save." (no silent overwrite).
- Entered ENG 30/40 → card shows Mathematics 82 A, English 70 A, **Overall 76.0 A**.
- Flags dropped to 25 across 5 student groups; home counts updated to 5 marks / 25 missing / 1 card.
- Service worker: scope `/app/`, state `activated`, cache `agentmark-app-v4` containing the shell.
- **Offline test:** stopped the HTTP server, reloaded the tab — the app still rendered from the
  service worker (title, "Good day.", 4 stat cards).
- No horizontal overflow at the 800 px test viewport.

### Why not a native APK in this phase

Measured on this machine:

- Google's Android CDN (`dl.google.com`) delivered **~28 KB/s**. The NDK alone is ~700 MB, the
  SDK/platform/build-tools another ~500 MB, plus Gradle/Maven dependencies — tens of hours at that
  rate, with a high chance of a failed partial install.
- No JDK, no Android SDK/NDK, no `ANDROID_HOME` on the machine.

A native build is still the right long-term answer for a teacher app that talks to the hub. The
Rust backend is already portable; the blockers are toolchain downloads, not architecture. The path
when a machine with the SDK is available:

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
npm i -g @tauri-apps/cli
cd hub-desktop
tauri android init      # generates src-tauri/gen/android
tauri android build --apk
```

This also needs a real sync/API surface on the hub (the current app has no network listener), so
the native APK is a Phase 11+ item, not a packaging step. The PWA is honest about being a companion.

### APK via GitHub Actions (Capacitor wrapper)

GitHub-hosted `ubuntu-latest` already has the Android SDK, so the **existing PWA** can be packaged
as an installable APK without touching this PC:

- `mobile/` is a small Capacitor 8 project. `npm run sync-web` copies `website/app/` into `www/`
  (the PWA remains the single source of truth); CI runs `cap add android`, `cap sync android`,
  then `gradlew assembleDebug`.
- The `android-apk` job in `.github/workflows/ci.yml` uploads `app-debug.apk` as the
  `agent-mark-mobile-apk` artifact. It is **debug-signed** and offline; data stays in the phone's
  `localStorage`, with no hub sync, signing or audit.
- The wrapper is a distribution convenience for the companion, not the native Tauri client. The
  WebView's `window.print()` is a no-op, so report printing stays on the desktop hub; JSON export
  needs Capacitor Filesystem/Share before it is useful on Android.
- Build/signing notes and limits: `mobile/README.md`.

---

## 4. Release procedure

```powershell
# 1. bump the version in src-tauri/tauri.conf.json (and Cargo.toml)
# 2. build + bundle + stage + stamp, all in one:
.\scripts\release.cmd          # .cmd wrapper: works when .ps1 files are blocked

#    if your execution policy allows scripts, the .ps1 is equivalent:
.\scripts\release.ps1

#    explicit version/notes:
.\scripts\release.cmd -Version 0.1.0 -Notes "First packaged pilot build."

# 3. deploy the static site
cd website
vercel --prod
```

This PC has PowerShell script execution disabled, so `.\scripts\release.ps1` is refused before it
runs. `release.cmd` invokes it with `-ExecutionPolicy Bypass`; use that, or set
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

`scripts/release.ps1` refuses to run if the requested version differs from `tauri.conf.json`, so
the installer filename and the manifest cannot drift.

`scripts/stamp_release.py` recomputes sizes and SHA-256 from the actual files and rewrites
`website/version.json` + `website/downloads/SHA256SUMS.txt`.

---

## 5. Known limits (stated on the site too)

1. **Unsigned installer** → SmartScreen "More info → Run anyway". A code-signing certificate is
   required before a frictionless school rollout.
2. **The MSI is per-machine and unsigned**; test it in a staging OU before a GPO/Intune rollout.
   The NSIS installer remains the no-admin option for individual teachers.
3. **Pilot gate is closed for real data**: no lock screen/roles enforced by the OS, signing key not
   passphrase-wrapped, backups are a summary payload rather than a full encrypted dump, external
   audit not closed.
4. **Mobile rules are duplicated in JavaScript.** They match the Rust engine today and were checked
   against known values, but a shared rules fixture (golden vectors consumed by both) is needed to
   prevent drift.
5. **`sitemap.xml` and `robots.txt` use the live Vercel alias** `mark-website-brown.vercel.app`.
   Update both when a custom domain is attached.
6. **The app cache is versioned by hand** (`app.js?v=0.1.2`, `agentmark-app-v4`). Bump both when
   the mobile shell changes.

---

## 6. Next

1. Code-sign the NSIS installer and MSI (EV certificate).
2. Close the pilot-gate findings: operator accounts + passphrase-wrapped key, full encrypted backup
   dump and restore-into-fresh-DB, then the external audit.
3. Native mobile client once an Android SDK machine is available — with a hub LAN API, not a
   duplicated rules engine.
4. Add a golden-vector test shared by `engine/`, `hub-desktop` and the PWA.
