# Phase 8 Hardening Notes (pre-pilot gate)
**Date:** 2026-10-16 | **Refs:** AUDITOR_SOW, THREAT_MODEL §5, BACKUP_RESTORE_RUNBOOK

## Crypto status (verified this phase)
- Relay E2E: real SealedBox (pynacl-1.6.2, installed). Pack tool auto-switched hmac-fallback → **ed25519** (re-ran `pack_sign_verify.py`: OK ed25519).
- Reports: `engine/reports.py` already prefers Ed25519 when nacl present — now active on this machine (was hmac-demo). Prod pins `pynacl==1.6.2` (`pip freeze` in CI).
- Backups: SecretBox (XSalsa20-Poly1305) with school-held key; split-custody shares; vault blobs opaque.

## Gate evidence (all executed)
- `pytest hub relay app engine` → **47/47** (6 backup incl. wipe→restore hash-equal drill artifact, tamper/wrong-key fail, custody split, updater bad-sig refusal + rollback, PII-grep clean).
- Drill artifact: `drill_report.json` (backup_id, db_hash, counts, PASS) + `backup_verified`/`drill_passed` flags unlock `go_live()` (tested).
- Remaining before real PII: external audit per AUDITOR_SOW (Criticals/Highs → zero), naive-user install trial, termly-drill scheduling in pilot charter. **Do not load student PII until auditor signs §5.**
