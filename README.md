# Agent Mark — Monorepo Root
Local-first school records & report-card system (No-AI).

## Docs (start here)
- `Agent_Mark_Ten_Year_Plan_No-AI.md` — vision
- `Agent_Mark_PRD.md` — requirements
- `Agent_Mark_Implementation_Plan.md` — phased plan (Plan→Build→Test→Document→Repeat)
- `Agent_Mark_TECH_DESIGN.md`, `Agent_Mark_DECISIONS.md`, `Agent_Mark_DATA_MODEL_RULES_SPEC.md`
- `Agent_Mark_THREAT_MODEL_PRIVACY.md`, `Agent_Mark_TEST_STRATEGY.md`
- `Agent_Mark_BACKUP_RESTORE_RUNBOOK.md`, `Agent_Mark_PILOT_CHARTER.md`, `Agent_Mark_AUDITOR_SOW.md`, `Agent_Mark_PARENT_NOTICE_CONSENT.md`
- `docs/REAL_DATA_READINESS.md` — **hard gate for the first real-student pilot.** The desktop technical
  core (accounts, encrypted vault, backup/drill/restore, mobile transfer, data lifecycle) is
  implemented and tested; signing, independent review, and school/legal gates remain open, so real
  PII is still blocked.
- `docs/PILOT_DEPLOYMENT_RUNBOOK.md` and `docs/pilot-pack/` — school deployment, DPIA, authorization,
  notices, retention, incident, data-subject, training, and sign-off templates.
- `docs/EXTERNAL_GATES_PLAYBOOK.md` — step-by-step certificate, independent-review, and school/legal
  sign-off path, including owners, evidence, commands, and a combined timeline.

## Layout
```
/hub-desktop   Tauri v2 desktop console (Rust + vanilla JS) — the shippable Hub
/website       Static download site for Vercel + installable mobile companion (PWA)
/mobile        Capacitor APK wrapper for the PWA companion (built by GitHub Actions)
/engine        Python reference engine: calc, validation, flags, comments, reports
/hub           Python reference hub: store, auth, encrypted backup, updater
/app           Python prototype of the teacher-app sync/pairing flow
/relay         Opaque relay prototype (sealed envelopes only)
/docs          Phase reports (PHASE_9_REPORT.md, PHASE_10_DISTRIBUTION.md, …)
/packs         Pack schemas + examples + sign/verify (Phase 0 v0)
/schemas       JSON schemas (Phase 0 v0)
/demo          Synthetic data only, never real PII
/scripts       Dev tooling (release, pack sign/verify, checks)
```

The Python trees are the executable reference implementation (47 tests); `hub-desktop` reimplements the
same rules natively and is what a school would install. Flutter was evaluated and deprioritised.

## Quick start
1. Read `Agent_Mark_DECISIONS.md` (10 ADRs locked).
2. **Desktop console:** `cd hub-desktop; .\build.ps1` (debug + launch) or `.\build.ps1 -Release`.
   See `hub-desktop/README.md` for the Zig/GNU build details and the headless test scripts.
3. **Reference engine:** `cd engine; python run_demo.py`; all Python tests: `python -m pytest engine hub relay app` (47/47).
4. Validate schemas + demo: `python scripts/validate_demo.py`.
5. Pack round-trip: `python scripts/pack_sign_verify.py`.

## Fresh clone
```powershell
python -m pip install -r requirements.txt                  # PyNaCl + pytest
python -m pip install -r requirements-tools.txt            # optional: screenshots/icons/PE checks
cd hub-desktop
python -m pip install --target tools/zig ziglang==0.16.0   # build toolchain (not committed)
.\build.ps1
```
Build output (`src-tauri/target`), `node_modules`, the 347 MB Zig toolchain and generated demo
data (`demo/output`: databases, backups, the demo key) are gitignored. The three release binaries
in `website/downloads/` **are** committed on purpose — Vercel serves them directly.

## Ship a release
```powershell
# Production releases require a signing identity (OV/EV certificate).
$env:AGM_SIGN_THUMBPRINT = "<SHA-1 thumbprint>"
.\scripts\release.cmd          # build + sign + NSIS/MSI + portable ZIP + website manifest
cd website; vercel --prod      # deploy the static site
```
Artifacts land in `website/downloads/`; `website/version.json` and `SHA256SUMS.txt` are regenerated
from the actual bytes, and `download.html` reads them at runtime (no hash edits in HTML). The release
script refuses to build a production release without `AGM_SIGN_THUMBPRINT` or
`AGM_SIGN_PFX`/`AGM_SIGN_PASSWORD`. For an internal pilot candidate that must not touch the public
manifest:

```powershell
.\scripts\release.cmd -AllowUnsigned -OutDir pilot-dist
```

Details: `docs/PHASE_10_DISTRIBUTION.md`, `docs/PILOT_DEPLOYMENT_RUNBOOK.md`, and `website/README.md`.
(`release.cmd` is a wrapper around `release.ps1` with `-ExecutionPolicy Bypass`; this PC refuses to
run `.ps1` files directly.)

The Android APK is built by `.github/workflows/ci.yml` on `ubuntu-latest`. Pushing a `v*` tag
(e.g. `git tag v0.2.0 && git push origin v0.2.0`) attaches the APK to a public GitHub Release;
`website/download.html` links to it. Without keystore secrets the APK is debug-signed and is a
preview only. With `AGM_ANDROID_KEYSTORE_BASE64` and its password/alias secrets configured, CI
builds a release-signed APK instead; see `mobile/README.md`.

## Tests
```powershell
cd hub-desktop\src-tauri; cargo test                 # 17 crypto/backup/CSV/mobile-format tests
cd hub-desktop; python tools\e2e_smoke.py 9223       # auth, roles, gate, backup/drill/recover, mobile import
cd hub-desktop; python tools\ui_smoke.py 9224        # real WebView setup/login/lock + lifecycle/fingerprint UI
cd hub-desktop; python tools\lifecycle_smoke.py 9236 # CSV, correction/export/delete, purge, audit
cd hub-desktop; python tools\recover_smoke.py 9225   # missing hub.db/vault.json/.bak -> restore from backup kit
cd hub-desktop; python tools\test_override_smoke.py 9230  # debug-only audited real-data test override
cd hub-desktop; python tools\test_override_ui_smoke.py 9234  # TEST DATA badge/banner/dashboard stat
cd hub-desktop; python tools\test_override_smoke.py 9235 --expect-blocked  # release build ignores the override
cd ..; python hub-desktop\tools\verify_db.py "%APPDATA%\org.agentmark.hub\agent-mark-hub" --user admin --password "your-password"
```
The last command is the offline auditor check: it opens the encrypted vault read-only, re-computes
the audit chain, verifies every locked report signature, and verifies every backup manifest,
signature, decryption, counts, audit head, and plaintext-leak check.

The Tauri CLI is installed globally (`npm i -g @tauri-apps/cli`, v2.12.4) so other Tauri projects on
this PC can run `tauri` without a local `node_modules`. PowerShell's execution policy blocks the
`tauri.ps1` shim; call **`tauri.cmd`** instead, or set
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Branching: `main` (protected, signed) ← `feat/<phase>-<short>` PRs, 1 reviewer + independent checker per phase.
Reference HW: Windows 10+ 64-bit, i3/4GB/128GB. No GPU.
