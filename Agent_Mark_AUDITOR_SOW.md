# Agent Mark — External Security Review Statement of Work

**Status:** Draft v2.0 for procurement
**Blocks:** real student PII in the first pilot
**Scope:** desktop hub + mobile local-data path only (local-first, single-school pilot)
**References:** `docs/REAL_DATA_READINESS.md`, `docs/PILOT_DEPLOYMENT_RUNBOOK.md`,
`hub-desktop/README.md`, `docs/REAL_DATA_TEST_OVERRIDE.md`

## 1. Objective

Obtain an independent, evidence-based opinion on whether the **local-data** deployment can safely
process real student PII under the school's NDPA 2023 controls. The review must answer:

1. Can an attacker who steals the PC, a backup, or an exported file recover plaintext student data
   without a valid passphrase/recovery code?
2. Can a staff account exceed its role, forge the actor, approve/lock a report it should not, or
   silently alter a score/report?
3. Do backup, restore, drill, and first-run recovery preserve confidentiality, integrity, and
   completeness under failure and tampering?
4. Does the mobile local store and `.agmm` transfer path keep data encrypted at rest and in transit
   between the phone and the desktop?
5. Are the installers, update path, audit trail, and data-lifecycle operations trustworthy enough for
   a controlled school pilot?

This is a narrow review of what is actually shipped. It is **not** a review of relay, cloud sync,
phone pairing, or multi-device always-on sync, which are not in this release.

## 2. Scope (in)

### Desktop hub
- Tauri/Rust backend and the local WebView console.
- Local accounts and Argon2id password wrapping; recovery code; session-bound actor; role matrix.
- Idle lock, manual lock, failed-attempt backoff.
- Whole-database XChaCha20-Poly1305 vault; in-memory SQLite; persistence format; key handling.
- Roster import (CSV parsing/validation/transaction), score entry/correction/deletion, comments,
  flags, report drafting/approval/lock/sign, audit hash chain.
- Backup snapshot + signed manifest + `vault-BK-*.json`; verify, restore-to-fresh, drill, first-run
  recovery, tamper rejection.
- Student edit/export/delete, score correction/deletion, live-data purge, stale-backup/drill warnings.
- Hub signing-key fingerprint and report signature verification.
- NSIS/MSI/portable packaging, signing hook, update/rollback procedure, local data-directory
  permissions.
- The debug-only real-data test override: confirm it is unavailable in release builds and cannot be
  enabled by environment variable alone.

### Mobile companion
- PWA/Capacitor app shell and Android hardening (`allowBackup=false`, `fullBackupContent=false`,
  `FLAG_SECURE`).
- Passcode-derived PBKDF2-SHA-256 key, AES-256-GCM local envelope, auto-lock, failed-attempt backoff,
  wipe.
- `.agmm` transfer format, separate transfer passphrase, AAD, import into the desktop hub,
  dry-run/idempotence/conflict handling.
- Device-loss/wipe procedure and the no-plaintext-files claim.

### Documentation and operations
- Threat model for the local-data scope.
- Pilot runbook, retention/backup schedule, incident and data-subject procedures.
- Claims in the website/download page and README that touch security or real-data readiness.

## 3. Out of scope

- Relay API, cloud store, always-on sync, phone pairing/QR scanner, multi-device sync.
- PDF generation, LAN sync, iOS, and features not present in the shipped build.
- Social engineering of school staff, physical intrusion beyond the stolen-disk/stolen-backup
  scenario, DDoS, and general internet-facing infrastructure.
- Legal advice, NDPA compliance certification, or the school's DPIA decision. The reviewer may comment
  on technical support for the school's controls but does not replace counsel/DPO.

## 4. Materials provided

- Source tree and build scripts; pinned Rust/Tauri versions and dependency lockfiles.
- Reproducible unsigned internal pilot artifacts (NSIS/MSI/portable) and SHA-256 hashes; a signed
  build when the certificate is available.
- Synthetic demo data and seeded error fixtures; the browser-generated `.agmm` fixture.
- Test evidence: Rust suite, E2E, UI, lifecycle, recovery, release-gate regression, offline verifier.
- Architecture walkthrough (up to 4 hours) and a threat-model workshop.
- A reference Windows PC and a low-end Android device if needed; no real PII.

## 5. Methodology (minimum)

1. Architecture and data-flow review.
2. Code review of crypto, auth/roles, persistence, backup/restore, import/export, report signing, and
   audit paths.
3. Static/dynamic analysis and dependency review.
4. Manual adversarial testing:
   - stolen-disk/stolen-backup/offline decryption attempts;
   - tampered ciphertext/manifest/backup and wrong-key tests;
   - role/actor escalation and approval/lock bypass attempts;
   - malformed CSV, oversized/control-character fields, duplicate/conflict imports;
   - score/report tampering and audit-chain edits;
   - mobile passcode brute-force/backoff, local-storage inspection, `.agmm` tamper/wrong-passphrase;
   - installer/update/rollback and local data-directory permission checks;
   - release-build test-override bypass attempt.
5. Restore/rollback drill witnessed by the reviewer.
6. Findings register and re-test after fixes.

## 6. Deliverables

1. Findings register: Critical/High/Medium/Low, reproduction, impact, affected artifact, fix guidance.
2. Security opinion letter: what the reviewer could and could not recover/forge/bypass, with
   assumptions and residual risk.
3. Threat-model review note for the local-data scope.
4. Remediation re-test note.
5. Short publishable summary (no exploit internals or student data).
6. Confirmation of the claims the website/README may safely make.

## 7. Acceptance and timeline

- Target: 2–3 weeks review, 1–2 weeks remediation, 1 week re-test. The school may adjust.
- **Real PII stays blocked until all Critical/High findings are closed and re-tested.** Medium/Low
  findings need an owner and date; the Head/DPO decides whether any can be accepted for the pilot.
- Acceptance requires all in-scope items tested, the opinion letter delivered, and the public summary
  approved.

## 8. Reviewer requirements

- Independent of Agent Mark; no conflict of interest.
- Demonstrated applied-crypto, Windows desktop, Android/mobile storage, and local-first privacy
  experience.
- Provides CVEs/tooling list and sample redacted report.
- Fixed fee with re-test included; NDA protects source and permits the public summary and remediation
  log.

## 9. Evaluation criteria

| Weight | Criterion |
|---|---|
| 30% | Applied crypto + Windows/Android local-data review depth |
| 25% | Education/children's-data privacy and NDPA context |
| 20% | Quality of sample findings and plain-language reporting |
| 15% | Restore/theft simulation and adversarial testing approach |
| 10% | Fixed fee, timeline, and re-test commitment |

**Attachments for RFQ:** `docs/REAL_DATA_READINESS.md`, this SOW, `docs/PILOT_DEPLOYMENT_RUNBOOK.md`,
`docs/pilot-pack/`, `hub-desktop/README.md`, and the release artifact hashes.
