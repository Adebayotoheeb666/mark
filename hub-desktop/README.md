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

The whole release (NSIS + MSI + portable ZIP + website manifest) is one command from the repo root:

```powershell
.\scripts\release.cmd
```

That also copies all three artifacts into `website/downloads/` and rewrites `website/version.json` +
`SHA256SUMS.txt` from the real bytes. See `docs/PHASE_10_DISTRIBUTION.md`.

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
   dry-run errors and *nothing* may be written. Real import is admin-only and requires real mode.
5. **Scores** → enter `26-JSS2A-001` `MATHS/CA1` = `17`. Then try `99` → `VAL-RANGE-01` refusal.
   Enter the same score twice with a different value → `VAL-DUP-01` refusal (no silent overwrite).
6. **Flags** → the inbox lists blocking `VAL-MISS-01` rows. `Confirm…` must demand a reason;
   `Correct`/`Escalate` resolve without one. Flags never change a score.
7. **Comments** → pick subject/band, choose a sentence, edit, save. Length gate blocks >210 chars.
8. **Reports** → `Draft all complete students`. Students with missing scores are skipped, not faked.
   Then teacher review → head review → `Lock+Sign` (only the head can lock/sign). `View` opens the
   print sheet — unlocked reports print a red **DRAFT — NOT OFFICIAL** banner.
9. **Backup & real-data gate** → `Clear demo`, `Backup now`, `Verify latest`, `Run restore drill`,
   acknowledge the privacy notice, then `Enable real data`. The app refuses to enable real mode until
   every gate is true.
10. **Audit** → every action above appears in the hash-chained log (each row hashes the previous
    hash, so tampering with history is detectable).

## Headless verification (no clicking)

Three scripts check the build without driving the UI:

- `python tools\verify_db.py <data-folder>` — opens the encrypted vault read-only with an account
  password, re-computes the audit hash chain, verifies the Ed25519 signature of every locked report,
  and verifies every backup manifest, signature, decryption, row counts, audit head, and plaintext
  leak check.
- `python tools\e2e_smoke.py 9223` — connects to the running app through WebView2's DevTools
  protocol and calls the same `invoke` bridge the UI uses, exercising setup, roles, wrong password,
  demo clearing, backup, verify, drill, real mode, mobile `.agmm` import, and disaster recovery.
- `python tools\ui_smoke.py 9224` — drives the real WebView setup/login/lock/auto-lock screens.

```powershell
$env:AGM_DATA_DIR = "$env:TEMP\agm-e2e"      # throwaway database (normal runs ignore this)
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
Start-Process .\src-tauri\target\debug\agent-mark-hub.exe
python tools\e2e_smoke.py 9223
python tools\verify_db.py "$env:TEMP\agm-e2e" --user admin.e2e
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
- Real-data mode defaults to off and requires zero demo rows, a verified backup, a passed drill,
  school details, and a privacy acknowledgment.
- Weight sums are checked per subject; a bad weight table blocks reports instead of guessing.
- Audit rows are hash-chained (`prev_hash` → `hash`), so edits break the chain.

## Known gaps before real student data

- No code-signing certificate yet; Windows SmartScreen warns on the installers.
- No independent security review yet. Engineering tests are green; that is not an audit.
- Retention/pruning, data-subject export/correction/erasure, and offboarding wipe are documented as
  requirements but not implemented as one-click features.
- No automatic backup scheduler, stale-backup block, key rotation, or account-removal UI.
- No relay/LAN sync client, no QR scanner, no PDF export (print-only MVP per ADR-0007).
- The Android APK is debug-signed until the keystore secrets are configured; the published 0.1.0 APK
  predates the encrypted mobile store.
- Real PII must stay out until the independent review and school/legal gates close. See
  `docs/REAL_DATA_READINESS.md`.
