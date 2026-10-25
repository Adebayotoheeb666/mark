# Agent Mark Hub — desktop console (Tauri v2)

Local-first school records console. Rust backend (SQLite, SQLCipher-free `rusqlite`, SQLite's own
encryption is *not* used — data is at rest in the app data dir; backups are encrypted), vanilla JS UI,
no AI/ML anywhere.

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

Data lives in `%APPDATA%\org.agentmark.hub\agent-mark-hub\hub.db` plus `backups\`. Delete that folder
for a factory reset.

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

- `src-tauri\target\release\bundle\nsis\Agent Mark Hub_0.1.0_x64-setup.exe` — per-user install,
  no admin prompt, WebView2 bootstrapper embedded.
- `src-tauri\target\release\bundle\msi\Agent Mark Hub_0.1.0_x64_en-US.msi` — per-machine install
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

1. **Dashboard** → `Load demo school (6 students)`. Readiness checklist should show the two hard
   blockers (no verified backup, no drill).
2. **Students** → try CSV import with one valid row + one duplicate: the duplicate must appear in the
   dry-run errors and *nothing* may be written. Then `Import for real`.
3. **Scores** → enter `26-JSS2A-001` `MATHS/CA1` = `17`. Then try `99` → `VAL-RANGE-01` refusal.
   Enter the same score twice with a different value → `VAL-DUP-01` refusal (no silent overwrite).
4. **Flags** → the inbox lists blocking `VAL-MISS-01` rows. `Confirm…` must demand a reason;
   `Correct`/`Escalate` resolve without one. Flags never change a score.
5. **Comments** → pick subject/band, choose a sentence, edit, save. Length gate blocks >210 chars.
6. **Reports** → `Draft all complete students`. Students with missing scores are skipped, not faked.
   Then `Teacher ✓` → `Head ✓` → `Lock+Sign` (button only appears once reviewed). `View` opens the
   print sheet — unlockable reports print a red **DRAFT — NOT OFFICIAL** banner.
7. **Backup** → `1. Backup now` writes an XChaCha20-Poly1305 blob + sha256 manifest and sets the
   verified flag. `2. Run restore drill` re-reads that blob, checks it against the manifest and only
   then passes. **Go Live stays blocked** until both are true.
8. **Audit** → every action above appears in the hash-chained log (each row hashes the previous
   hash, so tampering with history is detectable).

## Headless verification (no clicking)

Two scripts check the build without driving the UI:

- `python tools\verify_db.py <hub.db>` — read-only audit of a database: audit hash-chain
  integrity, the Ed25519 signature of every locked report, and that backup blobs contain no
  plaintext student data.
- `python tools\e2e_smoke.py 9223` — connects to the running app through WebView2's DevTools
  protocol and calls the same `invoke` bridge the UI uses, exercising the full path:
  scores → flags → drafts → teacher/head approval → lock+sign → comment → backup → drill →
  go live. It needs a seeded database and the remote-debugging port:

  ```powershell
  $env:AGM_DATA_DIR = "$env:TEMP\agm-e2e"      # throwaway database (normal runs ignore this)
  $env:AGM_AUTO_DEMO = "1"                      # seed 6 demo students at startup
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
  Start-Process .\src-tauri\target\debug\agent-mark-hub.exe
  python tools\e2e_smoke.py 9223
  python tools\verify_db.py "$env:TEMP\agm-e2e\hub.db"
  ```

  `AGM_DATA_DIR` and `AGM_AUTO_DEMO` exist only for testing/demos; a normal launch uses
  `%APPDATA%` and starts empty.

## Hard gates already enforced in code

- `report_lock` refuses without *both* a teacher and a head approval (`REP-INT-03`) and re-hashes the
  payload before signing (`REP-INT-02`).
- Report signatures are real Ed25519 (`ed25519-dalek`), key generated on first run and stored in
  `meta`. `report_lock` returns `AGM1:<id>:<sha256>:<sig>` for the QR payload.
- `go_live` requires `backup_verified=yes` **and** `drill_passed=yes`.
- Weight sums are checked per subject; a bad weight table blocks reports instead of guessing.
- Audit rows are hash-chained (`prev_hash` → `hash`), so edits break the chain.

## Known gaps before real student data (Phase 8 audit gate)

- No lock screen / per-user login yet (single-user local assumption; roles are asserted by the caller).
- Backup is a summary payload, not yet a full encrypted table dump + restore-into-fresh-DB routine.
- No relay/LAN sync client, no QR scanner, no PDF export (print-only MVP per ADR-0007).
- Real PII must stay out until the external audit closes all Critical/High findings.
