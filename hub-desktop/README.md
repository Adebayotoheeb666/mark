# Agent Mark Hub — desktop console (Tauri v2)

Local-first school records console. Rust backend (SQLite in memory, whole-database XChaCha20-Poly1305
vault at rest, Argon2id-wrapped keys), vanilla JS UI, no AI/ML anywhere.

The database is never written as plaintext SQLite. `hub.db` is an `AGMDB001` AEAD blob; the random
data key is wrapped by each staff account's password and by the printed recovery code in `vault.json`.
SQLCipher is not used.

## Run it

```powershell
cd hub-desktop
.\build.ps1              # debug build, then launches the app
.\build.ps1 -Release     # optimised .exe, no launch
```

The exe lands in `src-tauri\target\<debug|release>\agent-mark-hub.exe` and is self-contained (frontend
assets are embedded). That is controlled by the `custom-protocol` Cargo feature, which is on by
default: without it, `tauri-build` defines the `dev` cfg and the app tries to load `devUrl`
(`http://localhost:1420`) instead of the embedded UI. Use `--no-default-features` only when you
deliberately want that dev-URL behaviour.

The build uses the **`stable-x86_64-pc-windows-gnu` toolchain as both host and target**: build scripts and
proc-macros are host binaries, so an MSVC host would still need `link.exe` even when targeting GNU.
Install it once with `rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal`.

Data lives in `%APPDATA%\org.agentmark.hub\agent-mark-hub\`: `hub.db` (encrypted vault), `vault.json`
(staff accounts + wrapped data keys), and `backups\` (encrypted snapshots, signed manifests, and
`vault-BK-*.json` recovery copies). Delete that folder for a factory reset — after taking a backup.

## Test-only real-data override

Release installers keep the production real-data gate. For controlled workflow testing, the debug
build can bypass it when `AGM_TEST_ALLOW_REAL_DATA=1` is set, the account is an admin, no demo rows
remain, and you supply a reason of at least 12 characters. The override is written to the audit log
as `real_mode.test_override`, and every screen shows a red **REAL DATA TEST MODE** banner.

```powershell
# From the repo root. Uses %TEMP%\agent-mark-test-real and builds if needed.
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1 -Build
```

The standard release build cannot enable the override: it is gated on `cfg!(debug_assertions)` or an
explicit `--features allow-real-data-test` test build, plus the environment variable. See
`docs/REAL_DATA_TEST_OVERRIDE.md` for the safety rules and cleanup steps. Use synthetic or
explicitly authorized test data only; this is not a production database.

## Package a release (NSIS + MSI + portable ZIP)

The Tauri CLI is installed **globally** (`npm i -g @tauri-apps/cli`, v2.12.4), so no local
`node_modules` is needed. PowerShell blocks npm's `tauri.ps1` shim under the default execution
policy — call **`tauri.cmd`** (or fix the policy with
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`).

```powershell
cd hub-desktop
$env:PATH = "$PWD\tools\bin;$env:PATH"
$env:RUSTUP_TOOLCHAIN = "stable-x86_64-pc-windows-gnu"
tauri build --bundles nsis,msi
```

Outputs:

- `src-tauri\target\release\bundle\nsis\Agent Mark Hub_0.2.0_x64-setup.exe` — per-user install,
  no admin prompt, WebView2 bootstrapper embedded.
- `src-tauri\target\release\bundle\msi\Agent Mark Hub_0.2.0_x64_en-US.msi` — per-machine install
  (administrator required), suitable for Group Policy, Intune or SCCM.

The bundler downloads NSIS 3.13 and WiX 3.14 once and caches them under `%LOCALAPPDATA%\tauri`.
The WiX upgrade code is pinned in `tauri.conf.json` so MSI upgrades replace the old version instead
of installing side by side.

The whole release (NSIS + MSI + portable ZIP + website manifest) is one command from the repo root.
**Production releases require a code-signing identity.** The script refuses to build without one
unless you explicitly opt into an unsigned internal pilot build:

```powershell
# Production: OV/EV certificate installed in the current user's certificate store.
$env:AGM_SIGN_THUMBPRINT = "<SHA-1 thumbprint>"
.\scripts\release.cmd

# Alternative: PFX + password from the environment (never put the password in a command line).
$env:AGM_SIGN_PFX = "C:\secure\agent-mark-ov.pfx"
$env:AGM_SIGN_PASSWORD = "..."
.\scripts\release.cmd

# Internal pilot only: unsigned, clearly marked, not for public distribution.
.\scripts\release.cmd -AllowUnsigned -OutDir pilot-dist
```

`release.ps1` injects `scripts\sign-windows.ps1` as Tauri's `bundle.windows.signCommand`, then signs
and verifies the app exe, NSIS installer, and MSI with `signtool`. If signing fails, the release
fails. The default output goes to `website/downloads/` and rewrites `website/version.json` +
`SHA256SUMS.txt` from the real bytes; `-OutDir` keeps an internal pilot build out of the public
manifest. See `docs/PHASE_10_DISTRIBUTION.md` and `docs/PILOT_DEPLOYMENT_RUNBOOK.md`.

**Portable build:** `agent-mark-hub.exe` needs `WebView2Loader.dll` beside it. The release script
copies both into the ZIP; a bare exe copied on its own will fail to start.

## Why GNU + Zig (read before changing build settings)

This PC has **no Visual Studio / MSVC linker**. Microsoft's and GitHub's download hosts run at
~80 KB/s here (VS Build Tools would be a 10+ hour download), while PyPI runs at ~380 KB/s.

So the build uses Rust's **`x86_64-pc-windows-gnu`** target plus **Zig 0.16** as the compiler/linker:

| Piece | What it is |
| --- | --- |
| `tools/zig/` | Zig 0.16.0 (from the `ziglang` PyPI wheel), ships MinGW-w64 headers + import libs |
| `tools/src/zigcc.c` | `zigcc.exe` — forwards args to `zig cc -target x86_64-windows-gnu` (cargo linker + C compiler) |
| `tools/src/ar.c` | `ar.exe` — forwards to `zig ar` (bundled SQLite archive) |
| `tools/src/dlltool.c` | `dlltool.exe` — forwards to `zig dlltool` (import libs for `raw-dylib` crates) |
| `tools/src/windres.c` | `windres.exe` — resource compiler backed by `zig rc` (icon + manifest) |
| `.cargo/config.toml` | points cargo at the above |

The `zigcc` wrapper also normalises rustc's GNU link line, which Zig's driver does not accept
verbatim: it expands rustc's `@response-file`, drops `-nodefaultlibs`/`-lmsvcrt`/`-l:libpthread.a`,
injects `-lc` (which registers Zig's on-demand libc paths), rewrites Rust's target triple to Zig's
spelling, and passes proc-macro export lists (`-Wl,<tmp>\list.def`) positionally. Each workaround is
explained in `tools/src/zigcc.c`.

**Resources are real:** `windres` is backed by `zig rc` (LLVM's `rc`), so the exe carries the actual
icon, version block and the common-controls v6 manifest. That manifest is not cosmetic — without it
Windows loads comctl32 v5, `TaskDialogIndirect` is missing, and the process dies before the first
window with `0xC0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`). The shim writes a `.res` file under the
`.a` name `embed-resource` chose; `zigcc` recognises it by magic bytes and hands it to Zig with the
`.res` extension Zig requires. Installing Visual Studio Build Tools later and deleting
`.cargo/config.toml` restores the standard MSVC build (and NSIS/MSI installers) with no code changes.

Rebuild the shims (only needed if you move this folder or upgrade Zig):

```powershell
$zig = ".\tools\zig\ziglang\zig.exe"
& $zig cc -target x86_64-windows-gnu -O2 -o tools\bin\zigcc.exe   tools\src\zigcc.c
& $zig cc -target x86_64-windows-gnu -O2 -o tools\bin\ar.exe      tools\src\ar.c
& $zig cc -target x86_64-windows-gnu -O2 -o tools\bin\dlltool.exe tools\src\dlltool.c
& $zig cc -target x86_64-windows-gnu -O2 -o tools\bin\windres.exe tools\src\windres.c
& $zig cc -target x86_64-windows-gnu -c  -o tools\bin\empty.obj   tools\src\empty.c
```

If the folder moves, nothing in the repo needs editing: `.cargo/config.toml` uses relative
paths (`linker` from the workspace root, `[env]` values with Cargo's `relative = true`).

**Fresh clone:** the Zig toolchain is deliberately not committed (it is ~347 MB and `zig.exe`
is over GitHub's 100 MB file limit). The small `tools/bin` shims are committed, so the only
extra step is:

```powershell
cd hub-desktop
python -m pip install --target tools/zig ziglang==0.16.0
```

Then run `.\build.ps1` as usual. On a machine with Visual Studio Build Tools you can skip Zig
entirely, delete `.cargo/config.toml`, and build with the default MSVC toolchain.

## Test walkthrough (5 minutes, synthetic data only)

1. **First launch** → setup screen: school name, admin username, 12+ character password. Save the
   recovery code once; it is not shown again. The dashboard opens in **DEMO MODE**.
2. **Users** → add a teacher, head, and viewer. Each gets a temporary password and must change it at
   first sign-in. Admin cannot approve or lock reports.
3. **Dashboard** → `Load demo school (6 students)`. Readiness shows the real-data gate (backup, drill,
   privacy acknowledgment, demo cleared).
4. **Students** → try CSV import with one valid row + one duplicate: the duplicate must appear in the
   dry-run errors and *nothing* may be written. Quoted fields (for example `"Ada, Jr."`) are parsed
   correctly. As admin, use **Edit**, **Export**, or **Delete** on a row. Delete requires typing the
   student code and removes live scores/comments/flags/reports; the audit log and encrypted backups
   remain.
5. **Scores** → enter `26-JSS2A-001` `MATHS/CA1` = `17`. Then try `99` → `VAL-RANGE-01` refusal.
   Enter the same score twice with a different value → `VAL-DUP-01` refusal (no silent overwrite).
   Use **Correct or remove a score** with an 8+ character reason: a correction appends an immutable
   version; **Delete all versions** is admin-only.
6. **Flags** → the inbox lists blocking `VAL-MISS-01` rows. `Confirm…` must demand a reason;
   `Correct`/`Escalate` resolve without one. Flags never change a score.
7. **Comments** → pick subject/band, choose a sentence, edit, save. Length gate blocks >210 chars.
8. **Reports** → `Draft all complete students`. Students with missing scores are skipped, not faked.
   Then teacher review → head review → `Lock+Sign` (only the head can lock/sign). `View` opens the
   print sheet — unlocked reports print a red **DRAFT — NOT OFFICIAL** banner.
9. **Backup & real-data gate** → `Clear demo`, `Backup now`, `Verify latest`, `Run restore drill`,
   acknowledge the privacy notice, then `Enable real data`. The app refuses to enable real mode until
   every gate is true. The dashboard warns when the last backup is over 24 hours old, over 7 days old,
   or the last drill is over 30 days old. **Purge all live data** is a separate, double-confirmed
   offboarding action that keeps the audit log and does not delete backups.
10. **Audit** → every action above appears in the hash-chained log (each row hashes the previous
    hash, so tampering with history is detectable). **Account** shows the hub signing-key fingerprint
    to read out-of-band when verifying a signed report.

## Headless verification (no clicking)

Headless verification scripts:

These scripts check the build through the DevTools bridge and, for the UI tests, the real WebView:

- `python tools\verify_db.py <data-folder>` - opens the encrypted vault read-only with an account
  password, re-computes the audit hash chain, verifies the Ed25519 signature of every locked report,
  and verifies every backup manifest, signature, decryption, row counts, audit head, and plaintext
  leak check.
- `python tools\e2e_smoke.py 9223` - connects to the running app through WebView2's DevTools
  protocol and calls the same `invoke` bridge the UI uses, exercising setup, roles, wrong password,
  demo clearing, backup, verify, drill, real mode, mobile `.agmm` import, and disaster recovery.
- `python tools\ui_smoke.py 9224` - drives the real WebView setup/login/lock/auto-lock screens and
  checks the student lifecycle actions and signing-key fingerprint.
- `python tools\lifecycle_smoke.py 9236` - exercises quoted CSV parsing, student edit/export/delete,
  score correction/deletion, hub fingerprint, audit entries, and the offboarding purge.
- `python tools\recover_smoke.py 9225` - starts from a backup kit with no `hub.db`/`vault.json`
  (including `.bak`) and proves vault adoption plus restore.
- `python tools\test_override_smoke.py 9230` - with `AGM_TEST_ALLOW_REAL_DATA=1` on a debug build,
  proves the normal gate still blocks and the audited test override enters real-data mode.
- `python tools\test_override_ui_smoke.py 9234` - drives the setup form, opens the test panel, and
  confirms the TEST DATA badge, red banner, and dashboard stat after the override.
- `python tools\test_override_smoke.py 9235 --expect-blocked` - run against the **release** binary
  with `AGM_TEST_ALLOW_REAL_DATA=1`; proves the release gate ignores the override and stays in demo
  mode.

```powershell
$env:AGM_DATA_DIR = "$env:TEMP\agm-e2e"      # throwaway database (normal runs ignore this)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
Start-Process .\src-tauri\target\debug\agent-mark-hub.exe
python tools\e2e_smoke.py 9223
python tools\verify_db.py "$env:TEMP\agm-e2e" --user admin.e2e --password "Admin-Passphrase-2026!"
```

`AGM_DATA_DIR` exists only for testing; a normal launch uses `%APPDATA%` and starts at the setup
screen. The E2E creates its own admin account and does not need `AGM_AUTO_DEMO`.

## Hard gates already enforced in code

- Local accounts with Argon2id hashes; roles (`admin`, `head`, `teacher`, `viewer`) are enforced in
  Rust, and every mutation derives the actor from the authenticated session — never from the UI.
- 15-minute idle lock, manual lock, and failed-attempt throttling (5 failures, then exponential
  backoff from 30 s to 15 min).
- `report_lock` refuses without *both* a teacher and a head approval (`REP-INT-03`), re-hashes the
  payload before signing (`REP-INT-02`), and only the head role can lock/sign. Admin cannot approve.
- Report signatures are real Ed25519 (`ed25519-dalek`); the signing key lives inside the encrypted
  vault. `report_lock` returns `AGM1:<id>:<sha256>:<sig>` for the QR payload.
- The database is a whole-database XChaCha20-Poly1305 vault. SQLite runs in memory; the data key is
  wrapped by each password and the recovery code, never stored in plaintext.
- Backups are full encrypted snapshots with signed manifests; verify, restore-to-fresh, and drill
  check counts, digest, and the audit chain. A backup kit also carries `vault-BK-*.json` so a new PC
  can recover after losing `hub.db`.
- Student data lifecycle is audited: admin-only edit, JSON data-subject export, delete-with-code
  confirmation, score correction as an immutable new version, admin-only score deletion, and a
  double-confirmed live-data purge that keeps the audit log and leaves backups alone.
- The account screen shows a SHA-256 fingerprint of the hub's Ed25519 public key for out-of-band
  report verification.
- Real-data mode defaults to off and requires zero demo rows, a verified backup, a passed drill,
  school details, and a privacy acknowledgment. The dashboard warns about stale backups and drills.
- Weight sums are checked per subject; a bad weight table blocks reports instead of guessing.
- Audit rows are hash-chained (`prev_hash` → `hash`), so edits break the chain.

## Known gaps before real student data

- No OV/EV code-signing certificate has been issued yet. The release pipeline now requires and
  verifies a signature by default; `-AllowUnsigned` exists only for internal pilot builds, and
  Windows SmartScreen warns on unsigned artifacts. The hook was smoke-tested with a temporary
  self-signed certificate; a trusted certificate is still needed.
- No independent security review yet. Engineering tests are green; that is not an audit.
- No automatic backup scheduler or automatic retention/pruning. Stale-backup warnings are in the UI,
  and the retention schedule is a school procedure in the pilot pack; a human must still prune and
  store backups.
- No data-key rotation after a staff departure. The procedure is: remove the account, rotate every
  remaining password, destroy old backups under the retention policy, and treat any access to prior
  backups as a potential incident. See the pilot runbook.
- No relay/LAN sync client, no QR scanner, no PDF export (print-only MVP per ADR-0007).
- The Android APK is debug-signed until the keystore secrets are configured; the published 0.1.0 APK
  predates the encrypted mobile store. A release-signed 0.2.0 APK is still an external gate.
- Real PII must stay out until the independent review and school/legal gates close. See
  `docs/REAL_DATA_READINESS.md` and `docs/PILOT_DEPLOYMENT_RUNBOOK.md`.
