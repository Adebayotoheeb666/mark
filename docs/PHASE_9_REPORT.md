# Phase 9 Report — Desktop Hub Console (Tauri v2)
**Date:** 2026-10-25 | **Strategy:** Plan → Build → Test → Document → Repeat | **Result:** E2E PASS on an isolated database; release build produced. PII gate unchanged.

## Plan (done)

Move the Hub from a Python CLI/reference engine to something a school can actually double-click on a
staffroom PC, without Python, without a browser, and without internet. Constraints carried over from
the ADRs:

- **No AI/ML** anywhere in the product (deterministic rules only).
- **Local-first**: student data never leaves the machine; only sealed envelopes may leave later.
- **Windows-first**, single-user local install for the MVP.
- Keep the Python engine as the executable reference so behaviour can be diffed.

Chosen stack: **Tauri v2** — Rust backend (`rusqlite`, `ed25519-dalek`, `chacha20poly1305`) and a
vanilla-JS frontend with no npm build step, so the shipped binary is self-contained.

## Build (done)

### Backend — `src-tauri/src/main.rs` (755 lines, 21 commands)

| Area | Commands |
| --- | --- |
| Readiness | `dashboard`, `seed_demo` |
| Roster | `students`, `roster_import` (dry-run first) |
| Scores | `score_add`, `results` |
| Validation | `flags_scan`, `flags`, `flag_dispose` (reason required to confirm) |
| Comments | `comment_pick`, `comment_preview`, `comment_save` |
| Reports | `reports_draft_all`, `reports`, `report_approve`, `report_lock`, `report_html` |
| Backup | `backup_create`, `drill_run`, `go_live` |
| Audit | `audit_list` |

SQLite schema: `meta`, `students`, `assessments`, `scores`, `flags`, `comments`, `reports`, `audit`.
WAL enabled; database lives at `%APPDATA%\org.agentmark.hub\agent-mark-hub\hub.db`.

Rules that are enforced in Rust rather than in the UI:

- `score_add` refuses out-of-range values (`VAL-RANGE-01`) and silent overwrites (`VAL-DUP-01`).
- `flags_scan` is advisory only; flags never mutate a score.
- `reports_draft_all` **skips** students with incomplete score sets instead of inventing marks.
- `report_lock` requires a teacher *and* a head approval (`REP-INT-03`), re-hashes the payload
  (`REP-INT-02`), then signs it with Ed25519 and returns `AGM1:<id>:<sha256>:<sig>`.
- `go_live` stays blocked until `backup_verified=yes` **and** `drill_passed=yes`.
- Every mutation appends a hash-chained audit row (`hash = sha256(actor|action|entity|before|after|prev)`).

### Frontend — `src/` (228 lines JS, 32 lines CSS)

Eight screens in one page: Dashboard, Students, Scores, Flags, Comments, Reports, Backup, Audit.
No framework, no bundler. Report preview is an in-app iframe overlay with a Print button rather than
`window.open`, so printing works inside the Tauri webview.

### Build infrastructure (the hard part)

This machine has no Visual Studio/MSVC, and the Microsoft/GitHub download hosts were unusably slow, so
the build uses **`stable-x86_64-pc-windows-gnu` as both host and target** plus **Zig 0.16** as
compiler/linker. Host matters: `cargo` compiles build scripts and proc-macros for the host, so an MSVC
host would still need `link.exe`.

Shims in `tools/bin/` (sources in `tools/src/`):

- `zigcc.exe` — linker + C compiler. Expands rustc's `@response-file`, drops
  `-nodefaultlibs`/`-lmsvcrt`/`-l:libpthread.a`, injects `-lc`, rewrites Rust's triple to Zig's
  spelling, passes proc-macro `.def` export lists positionally, resolves `WebView2Loader.dll` to its
  import lib, switches to an `@rsp` file past the 32 KB command-line limit, and routes `.res` inputs
  by magic bytes.
- `ar.exe`, `dlltool.exe` — forward to `zig ar` / `zig dlltool`.
- `windres.exe` — parses `embed-resource`'s flags, runs `zig rc`, and emits a real `.res`. This is what
  embeds the icon, version block and the **common-controls v6 manifest**. Without that manifest the
  process aborts at startup with `0xC0000139` (`TaskDialogIndirect` missing from comctl32 v5).

`.cargo/config.toml` must sit in `hub-desktop/` (cargo reads config from the working directory upward,
not from the `--manifest-path` directory), and `build.ps1` therefore `Set-Location`s to the repo root.
All shim paths in it are absolute, so moving the folder requires regenerating that file.

`Cargo.toml` enables `custom-protocol` by default. Without it `tauri-build` sets the `dev` cfg and the
app tries to load `http://localhost:1420` instead of the embedded frontend — a plain `cargo build`
would produce a blank window.

## Test (done — executed)

### End-to-end through the real app (no clicking)

`tools/e2e_smoke.py` connects to the running app over WebView2's DevTools protocol and calls the same
`window.__TAURI__.core.invoke` bridge the UI uses. Run against a throwaway database
(`AGM_DATA_DIR=%TEMP%\agm-e2e`, `AGM_AUTO_DEMO=1`):

| Step | Observed |
| --- | --- |
| seed + roster | 6 students |
| score entry | 25 scores across 5 students (one student deliberately left blank) |
| flags | 5 open, all `VAL-MISS-01` |
| draft all | 5 reports (the incomplete student is skipped) |
| teacher approve | status `reviewed` |
| head approve | recorded in `approvals` |
| lock + sign | `AGM1:RPT-2026-T1-26-JSS2A-001-v1:7fa0f253…:445fb888…` |
| report HTML | print sheet present, **no** DRAFT banner once locked, approvals block present |
| comment | template `maths-a-enc-00`, 95 chars, `blocked=false`, saved |
| backup | sealed blob written |
| drill | `Drill PASS: backup decrypt+hash verified (77 bytes)` |
| go live | `LIVE` |
| dashboard | 6 students / 25 scores / 5 open flags / 1 locked report / backup ✓ / drill ✓ / live ✓ |

### Independent integrity check

`tools/verify_db.py` re-reads the same database **read-only** and checks the guarantees from first
principles (not through app code):

```
audit: 34 rows, hash chain intact
report RPT-2026-T1-26-JSS2A-001-v1: payload_hash_ok=True signature_ok=True
backups: 2 sealed file(s), plaintext leaks=[]
RESULT: PASS
```

The signature is verified with `PyNaCl` against the hub key, and the backup blobs were grepped for
student names, class codes and subject strings — none present.

### Regression

- Python reference engine: **47/47 tests** still pass (unchanged this phase).
- Debug build: `agent-mark-hub.exe` launches, window renders, database initialises, demo seeding works.
- **Release build:** `.\build.ps1 -Release` → `src-tauri\target\release\agent-mark-hub.exe`, **15 MB**,
  built in 4m58s. Verified from the PE headers: `Subsystem = 2` (GUI — no console window) and
  resources `RT_ICON`, `RT_GROUP_ICON`, `RT_VERSION`, `RT_MANIFEST` present.
- The full E2E was then **re-run against the release binary** (port 9224, fresh database): identical
  results — 6 students, 25 scores, 5 flags, 5 drafts, lock+sign, backup, drill, `LIVE`, 34 audit rows —
  and `tools/verify_db.py` returned PASS on that database. A CDP DOM probe confirmed the embedded UI
  renders in the release exe: 8 nav buttons, stat cards, seeded dashboard text.
- The frontend cannot be found with a plain string search in the exe because Tauri stores embedded
  assets brotli-compressed; the E2E run is the proof that they are there.

## Document (done)

- `hub-desktop/README.md`: build rationale, shim rebuild commands, `.cargo` location, `custom-protocol`
  behaviour, data path + factory reset, 8-step manual walkthrough, headless test recipe, hard gates,
  known gaps.
- `tools/e2e_smoke.py` and `tools/verify_db.py` are checked in and documented, so the test is
  repeatable by a non-developer.
- This report.

## Gate status

Phase 8's hard gate is **not** lifted by this work: the desktop console is still the same logic, now
packaged. Before any real student data:

- [ ] External auditor closes all Critical/High findings.
- [ ] Auditor countersigns `THREAT_MODEL_PRIVACY.md` §5.
- [ ] Pilot charter + parent notice signed for the pilot school.

New gaps introduced or still open at this layer:

- No lock screen or per-user login; roles (`teacher`/`head`) are asserted by the caller. Acceptable only
  on a single-user staffroom PC, and must be closed before multi-staff use.
- The Ed25519 private key is stored in the local database (`meta.hub_priv`). It never leaves the
  machine, but it is not yet passphrase-wrapped or split-custody as ADR-0005 intends for production.
- Backups are a summary payload, not yet a full encrypted table dump plus restore-into-fresh-DB.
- No installer (NSIS/MSI), no code signing, no auto-update channel.
- No relay/LAN sync, no QR scanner, no PDF export (print-only MVP per ADR-0007).

## Repeat → next

1. **Auth + custody**: passphrase-wrapped hub key, local operator accounts, role enforcement in Rust
   rather than trusting the caller.
2. **Installer + updates**: MSI/NSIS bundle and the Ed25519-signed update path already prototyped in
   `hub/updater.py`.
3. **Full-database backup/restore**: extend `backup_create` to a complete encrypted dump and add the
   restore-into-fresh-DB routine the Phase 8 runbook describes.
4. Then Phase 10 pilot onboarding (charter, roster import rehearsal, drill evidence pack).
