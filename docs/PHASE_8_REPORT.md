# Phase 8 Report — Backup/Restore + Hardening + Security Review Prep
**Date:** 2026-10-16 | **Strategy:** Plan → Build → Test → Document → Repeat | **Result:** HARD GATE PASSED (code) → auditor review before pilot PII

## Plan (done)
Encrypted dual-copy backups, verify-first restore, mandatory drill artifact, split-custody keys, signed updates + rollback, PII-grep, ed25519 promotion.

## Build (done)
- `hub/backup.py` — data-key gen, custody split/join, SecretBox backup + manifest (counts, db_hash), verify_only, restore (verify-first, count-match), drill (backup→scratch→hash-equal + flags + artifact)
- `hub/updater.py` — Ed25519 release sign/verify, bad-sig refusal, rollback handle
- `hub/HARDENING_NOTES.md` (crypto status, evidence, remaining audit step)

## Test (done — executed)
- Full suite → **47/47 passed** (6 backup + 41 prior)
- Hash-equal wipe→restore + artifact unlocks go-live; tampered/wrong-key fail; shares reveal nothing alone; bad-sig update refused + version intact; relay/crypto PII-grep clean; pack tool now ed25519 (fixed this phase); restore row_factory bug caught + fixed + re-green

## Document (done)
Runbook (pre-existing) + hardening notes; drill artifact schema (`drill_report.json`).

## Repeat / Gate G8→Pilot (HARD)
- [x] 100% drill + rollback proven in code; [ ] external review Criticals/Highs closed; [ ] auditor countersigns THREAT_MODEL §5. **No real student data until all three hold.**
