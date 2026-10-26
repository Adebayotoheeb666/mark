# Real-Data Readiness Gate — Desktop + Mobile Pilot

**Status:** **BLOCKED — synthetic/demo data only. Do not enter real student PII.**
**Date:** 2026-10-25
**Scope:** Agent Mark Hub desktop `v0.2.0` (Tauri + Rust + encrypted SQLite) and the mobile
companion (PWA / Capacitor APK), first single-school pilot.
**Decision owners:** School Head/DPO + Agent Mark tech lead. Independent reviewer signs the security gate.

**Confirmed for the first pilot (2026-10-25):**
- Shared staffroom Windows PC (multiple staff accounts, one school).
- Mobile/PWA must handle real data too; the first mobile release uses a passcode, encrypted local
  storage, auto-lock, and an encrypted export to the desktop hub (no cloud relay/sync in the first
  release).
- Compliance context: Nigeria — NDPA 2023 (school counsel/DPO confirms the legal basis and notices).
- Low-cost signing/audit path: OV code-signing certificate first; narrow independent review to the
  desktop+mobile local-data scope; no EV-only dependency.

This document is the go/no-go gate for the first real deployment. It is deliberately stricter than
"the app runs." A green E2E test is not a security review, and a demo is not a pilot.

---

## 1. Current state (2026-10-25)

The desktop technical core and the mobile local-data path are implemented. The remaining blockers are
distribution trust, external review, and school/legal operations — not the core data path.

| Area | Current state | Evidence |
|---|---|---|
| Login / roles | Local accounts, Argon2id (64 MiB, t=3, p=1), session-bound actor, role checks in Rust. | `vault.rs`, `main.rs`; E2E role matrix |
| Lock / throttling | 15-minute idle lock, manual lock, 5 failures then exponential backoff (30 s → 15 min). | `main.rs`; UI smoke |
| Signing key | Ed25519 private key lives inside the encrypted database; public key in the same vault. | `hub_keys()` in `main.rs` |
| Database at rest | Whole-database XChaCha20-Poly1305 AEAD vault; SQLite is opened in memory and persisted as ciphertext. No plaintext DB/WAL. | `store.rs`; encrypted-reopen test |
| Backup | Full encrypted snapshot (`AGMBK001`) + signed JSON manifest (schema, counts, SHA-256, timestamp, hub signature) + a `vault-BK-*.json` wrapped-key copy so a replacement PC can recover. | `backup_create`; Rust tests |
| Restore / drill | Restore into a fresh in-memory DB; verify counts, digest and audit chain; only then replace live state. First-run disaster recovery restores from the backup folder when `hub.db` is missing. | `restore_backup`, `recover_from_backup`, `drill_run`; E2E |
| Real-data mode | Defaults to `demo`; `real` requires zero demo rows, verified backup, passed drill, school name and privacy acknowledgment. | `enable_real_mode`; E2E |
| Mobile local store | Passcode-derived key (PBKDF2-SHA-256, 310,000 iterations), AES-256-GCM envelope in `localStorage`, 8+ character passcode, 5-minute default auto-lock, lock button, wipe. Android shell hardened (no backup, no screenshots). | `website/app/app.js`; `scripts/patch_android_hardening.js`; browser smoke |
| Mobile transfer | `AGMMOB01` file: salt(16) + IV(12) + AES-256-GCM ciphertext, separate 12+ character transfer passphrase, AAD `AGM-MOBILE-TRANSFER-V1`. Desktop import is admin-only, real-mode-gated, dry-run first, idempotent. | `mobile_import`; Rust cross-implementation fixture + E2E |
| Installers | NSIS/MSI are still unsigned. | `website/downloads/` |
| Android | Debug-signed APK by default. CI has an optional release-signing path once keystore secrets exist. | `.github/workflows/ci.yml` |
| Independent review | Not started. | — |
| School/legal | Not completed. | — |

### Role matrix (enforced in Rust)

| Action | admin | head | teacher | viewer |
|---|---|---|---|---|
| Setup / add users / reset password | yes | no | no | no |
| Backup / verify / drill / restore | yes | no | no | no |
| Enable real mode / clear demo / import roster or mobile file | yes | no | no | no |
| Enter/edit scores, draft reports | yes | yes | yes | no |
| Approve draft report (teacher review) | no | yes | yes | no |
| Approve reviewed report (head review) | no | yes | no | no |
| Lock/sign report | no | yes | no | no |
| View audit | yes | yes | no | no |

Admin cannot approve or lock reports; a teacher cannot approve their own reviewed report into the
head stage; the head is the only role that locks/signs.

### Engineering evidence

Run these on a clean data directory:

```powershell
cd hub-desktop\src-tauri; cargo test
cd hub-desktop; python tools\e2e_smoke.py 9223
cd hub-desktop; python tools\ui_smoke.py 9224
cd hub-desktop; python tools\recover_smoke.py 9225   # after copying a backup kit and deleting hub.db/vault.json/.bak
```

The Rust suite currently covers: encrypted blob round-trip, wrong key, tampered ciphertext, missing
database, encrypted persist/reopen, backup round-trip/restore-to-fresh, tampered backup, tampered
manifest, missing manifest, wrong hub key, disk backup discovery, vault-kit adoption, and a
browser-generated `.agmm` fixture (proves the PWA and Rust use the same PBKDF2/AES-GCM format). The
E2E covers setup, roles, wrong password, demo clearing, backup, verify, drill, privacy acknowledgment,
enabling real mode, mobile dry-run/import/idempotence, tamper rejection, and disaster recovery from
the on-disk backup kit. `recover_smoke.py` additionally deletes `hub.db`, `vault.json`, and their
`.bak` copies, starts the app with only the backup folder, and proves the app adopts
`vault-BK-*.json`, restores, and unlocks.

**Immediate rule:** until this gate is green, use the demo school or synthetic data only. If real data
has already been entered in a test copy, delete that copy and its backups.

---

## 2. Target first deployment

The smallest surface we can make genuinely safe is:

- **One school, one shared staffroom Windows 10/11 PC** (or a single head/teacher PC).
- **Desktop is the system of record.** The PWA/APK can enter real data only after it has a passcode,
  encrypted local storage, auto-lock, and an encrypted export/import path to the desktop hub. The first
  mobile release is air-gapped: no cloud relay, no always-on sync, no shared login.
- Local accounts for Head, Admin/Exams, Teacher, and IT/Viewer; no shared "admin" login.
- BitLocker enabled, Windows updates current, standard user for daily work, admin only for install.
- One primary backup target plus one off-site/secondary copy, with a witnessed restore drill.
- School Head/DPO owns the data and the passphrase custody; Agent Mark does not receive PII.

This profile avoids the relay, phone pairing, multi-device sync, and cloud vault work that the older
PRD/SOW describe but the current desktop app does not implement. Mobile real data is a separate,
encrypted local store plus an explicit transfer step; it is not a second always-on database.

---

## 3. Hard gate

### A. Identity and access

- [x] Local user accounts with Argon2id password hashes; no default or shared passwords.
- [x] Roles enforced in Rust: `admin`, `head`, `teacher`, `viewer`; least-privilege matrix documented
      above.
- [x] Every mutation derives `actor` from the authenticated session, not from the UI payload.
- [x] Auto-lock after inactivity; manual lock; failed-attempt throttling.
- [x] Head approval and report lock require the correct role; teacher cannot self-approve into the head
      stage; admin cannot approve or lock.
- [x] Admin recovery path is documented and tested (recovery code kept offline, not in the DB).
- [x] UI has no hardcoded staff names or `actor: "admin"` calls.

### B. Encryption and key custody

- [x] Database encrypted at rest with SQLCipher or an approved whole-database AEAD vault. Current
      implementation: XChaCha20-Poly1305 whole-DB vault; auditor acceptance is still required.
- [x] Random 256-bit data key wrapped by each user's password (Argon2id); the passphrase is never
      stored.
- [x] Ed25519 signing key wrapped by the same master key (it lives inside the encrypted DB); the
      public key is available for report verification.
- [ ] Public-key fingerprint is shown in the UI for out-of-band report verification.
- [x] Backup encryption uses a school-held key/recovery kit, not a key stored beside the ciphertext.
      Backups are encrypted with the data key; the data key is wrapped by user passwords and the
      printed recovery code, never written beside the backup.
- [x] Recovery kit (printed, sealed) explains passphrase custody and what is unrecoverable without it.
- [ ] Key rotation and staff departure procedure documented and tested.
- [ ] Disk-level protection (BitLocker) documented as defence in depth, not the only control, and
      verified on the pilot PC.

### C. Backup, restore, and drill

- [x] Backup is a consistent full snapshot of the encrypted database, plus a manifest with schema
      version, counts, byte size, SHA-256, timestamp, and hub public-key signature.
- [x] Backup verifies by opening the snapshot with the school key, running `PRAGMA integrity_check`,
      checking counts and the audit hash chain.
- [x] Restore writes to a **fresh** database, verifies it, then atomically replaces the live DB only
      after the app closes/reopens safely.
- [x] First-run disaster recovery can restore from the backup folder when `hub.db` is missing, using
      the account password and the `vault-BK-*.json` copy.
- [x] Drill restores the latest backup into a scratch directory and proves row counts, representative
      report hashes, flags, and audit chain match; a failed drill cannot set `drill_passed`.
- [ ] Primary + secondary copies; retention (last 10 daily, 3 term, 1 yearly) and stale-backup banner.
- [ ] Backup/restore runbook rehearsed by the school's named custodians, with a signed drill artifact.
- [ ] Offboarding wipe and "restore to a new PC" procedure tested.

### D. Data lifecycle and real-data mode

- [x] `data_mode` is `demo` by default; `real` requires a completed setup checklist.
- [x] Real mode is blocked until: admin account created, passphrase set, backup verified, restore
      drill passed, school details entered, privacy notice acknowledged, and zero demo rows remain.
- [x] Roster import dry-run and real import are separate; real import requires an explicit
      confirmation and admin role.
- [ ] Retention schedule, data-subject request/export, correction, and deletion/purge procedures exist.
- [x] Comments/reports have an approval and correction path; locked reports are versioned, not
      silently overwritten.
- [x] Audit log records actor, action, entity, before/after, timestamp, and hash chain; access to the
      audit view is role-controlled.
- [x] No PII in logs, crash reports, filenames, or telemetry. (There is no telemetry.)

### E. Distribution trust

- [x] Android companion shell hardened at the platform level: `android:allowBackup="false"` +
      `android:fullBackupContent="false"`, and `FLAG_SECURE` (no screenshots / screen recording) via
      `mobile/scripts/patch_android_hardening.js`, run in CI before any APK build.
- [x] PWA app shell served with a strict Content Security Policy (`default-src 'self'; script-src 'self';
      style-src 'self' 'unsafe-inline'; ...), service worker cache bumped to `agentmark-app-v6`.
- [ ] NSIS and MSI signed with an OV/EV code-signing certificate; signature verified on a clean PC.
- [ ] MSI per-machine install tested by school IT; NSIS per-user install tested for non-admin PCs.
- [ ] Release manifest and SHA-256 published; download page links the signed bytes.
- [ ] Android: release-signed APK with a documented keystore custody process; debug builds are never
      offered for real data. CI has the conditional signing path; the keystore itself is not yet held.
- [x] Mobile real-data gate: app passcode (PBKDF2-SHA-256, 310,000 iterations), encrypted local store,
      auto-lock, no PII in plaintext files or logs, encrypted export/import to the desktop hub, and a
      device-loss/wipe procedure.
- [ ] Update path documented: how a school gets a security fix without losing data; rollback tested.

### F. School, legal, and operations

Assuming Nigeria/NDPA 2023 unless the school confirms another jurisdiction. The school's counsel/DPO
must approve the legal basis and notices; this is not legal advice.

- [ ] School authorization: named Head/DPO, pilot scope, data categories, retention, and sign-off.
- [ ] DPIA for children's data and the local processing model; risks and mitigations recorded.
- [ ] Data processing agreement (controller/processor) or a clear local-only statement of roles.
- [ ] Privacy notice for staff/parents; parent/guardian notice and consent where the school requires it.
- [ ] Data subject request, correction, export, and erasure procedure with response times.
- [ ] Breach/incident response: containment, notification decision, 72-hour regulator path, school
      contact.
- [ ] Staff training: passphrase custody, backup, phishing, device locking, report approval, no personal
      phones for real data.
- [ ] Device hardening checklist: BitLocker, updates, antivirus, separate Windows accounts, no shared
      admin, screen lock, physical security.
- [ ] Support boundary: what Agent Mark can see (nothing by default), how remote support is authorized,
      and how PII is kept out of support tickets.

### G. Independent review and pilot

- [ ] Narrow the audit SOW to the desktop+mobile local-data scope: local auth, crypto/key storage, DB
      encryption, backup/restore/drill, mobile encryption/transfer, report signing, installers, data
      lifecycle, and docs. Remove relay/phone-pairing scope until those features exist.
- [ ] Independent reviewer performs architecture/code review and a restore/theft simulation.
- [ ] Critical/High findings closed and re-tested; Medium/Low have owners and dates.
- [ ] Reviewer signs the threat model and the opacity/security opinion for the local-data scope.
- [ ] Pilot starts with one class/term and synthetic shadow run, then a small real-data cohort with
      consent; weekly review and a rollback plan.
- [ ] Pilot success criteria and stop conditions agreed in writing before real data is loaded.

---

## 4. Work packages

| WP | Deliverable | State | Exit test |
|---|---|---|---|
| WP1 | Accounts, roles, lock screen, session-bound actor | **Implemented** | Role matrix tests; no caller-supplied actor; auto-lock test |
| WP2 | Encrypted DB, passphrase-wrapped keys, recovery kit | **Implemented** | Stolen-disk simulation yields no plaintext; wrong passphrase fails |
| WP3 | Full encrypted backup, verify, restore-to-fresh, real drill | **Implemented** | Wipe live DB → restore → counts/report hashes/audit chain match |
| WP4 | Real-data mode, retention/export/purge, offboarding | **Partial** — gate done; retention/purge/offboarding not done | Real import blocked until checklist green; purge test passes |
| WP5 | Signed Windows installers; release-signed Android APK | **Blocked on certificate/keystore** | Signature check on clean PC; APK signing verified |
| WP6 | Mobile passcode, encrypted local store, auto-lock, encrypted export/import | **Implemented** | Wrong passcode fails; stolen-device simulation finds no plaintext; export round-trip matches |
| WP7 | School pack: DPIA, DPA/privacy notice, parent notice, runbooks, training | **Not started** | School sign-off; staff complete training |
| WP8 | Independent review, fixes, re-test, pilot | **Not started** | Critical/High closed; reviewer sign-off; pilot go/no-go |

WP1–WP3 and WP6 are engineering-complete for the first release. WP4's retention/purge/offboarding work
and WP5's signing remain. WP7 needs the school and its advisers. WP8 needs an independent reviewer and
cannot be self-certified.

---

## 5. Go/No-Go sign-off

Real data may be loaded only when all of the following are true and recorded:

| Gate | Owner | Evidence | Date |
|---|---|---|---|
| Technical gate A–D green | Agent Mark tech lead | Test log + drill artifact | |
| Installers/APK trust gate E green | Release owner | Signature verification | |
| School/legal gate F green | School Head/DPO | Signed authorization + notices | |
| Independent review gate G green | Reviewer | Findings register + sign-off | |
| Pilot plan and rollback agreed | School + Agent Mark | Signed pilot charter | |

Until then: **demo/synthetic data only.**

---

## 6. What not to claim yet

The website and docs must not imply that the current build has signed installers, a release-signed
APK, an independent security audit, school/legal approval, cloud sync, or phone pairing. The desktop
app is local-only; the relay/mobile sync in the older PRD is not shipped. The mobile app is an
encrypted local companion with explicit `.agmm` transfer, not a second always-on database. Correct
the claims before the pilot, or build the features and then claim them.
