# Agent Mark — Backup, Restore & Key Management Runbook
**Status:** Draft v1.0 | **Required for:** Phase 8 hard gate (no PII without drill proof) + PRD FR-BKP-001–005
**Keep:** Printed copy in school safe + USB with installer. Review termly.

## 1. Rule (non-negotiable)
Live DB + **at least one verified backup** before any term lock or report run. Hub enforces: Go-Live and Term-Lock buttons stay disabled until `last_verified_backup` is fresh (≤7 days in term, ≤24h in report week).

## 2. Targets (pick ≥1 primary + 1 secondary)
| Target | How | Key | Notes |
|---|---|---|---|
| A. USB drive | Hub → one-click Backup → encrypted `.agm` file + `manifest.json` | School data-key | Keep USB off-site (head's office/home safe). Rotate 2 sticks. |
| B. On-site 2nd PC | Hub → LAN push (TLS, hub-signed) to Backup Agent folder | School data-key | Survives single-PC death. Verify LAN monthly. |
| C. Cloud vault (opaque) | Hub → sealed PUT to vault endpoint (ciphertext only) | School data-key, operator cannot decrypt | Survives fire/theft of both PCs. Small monthly fee. |

All three formats identical; restore tries any. Manifest: `{backup_id, ts, school_id, counts{students,scores,results}, db_hash, sig}`.

## 3. Schedules & Retention
- **Auto:** daily 18:00 during `term=active`; plus pre-report snapshot on every batch generate.
- **Manual:** Admin → Backup → "Backup now" before any bulk import, pack upgrade, or update.
- **Retention:** keep last 10 daily + 3 term snapshots + 1 yearly. Vault: same, server enforces per-school quota.
- **Overdue escalation:** >3 days stale in term → banner + Head/IT reminder; >7 days → block new term lock until fresh backup.

## 4. One-Click Backup (operator steps)
1. Hub → Backup → check targets ticked (A/B/C) → "Backup now".
2. Wait for `Integrity: hash match, N students / M scores` + green `Verified`.
3. If USB: safely eject, label `AGM <school> <date> <backup_id short>`, store off-site. Log location in book.
4. Confirm dashboard `Last verified: <ts>` updated. Done (<5 min target).

## 5. Restore — Dry-Run First (always)
1. On replacement/repaired PC: install Hub (same major version) → "Restore from backup" → plug USB / pick 2nd-PC / pull vault (needs recovery phrase + hub trust approval).
2. Select backup → **"Verify only"**: checks decrypt + hash + counts + audit-chain head. Must show `MATCH`.
3. **"Restore"**: overwrites local DB → auto re-verify → reboot service → open dashboard, confirm counts + spot-check 5 students + 1 report re-render hash-equal.
4. Re-pair teacher devices if hub keys changed (see §7); revoke old hub key; log restore in audit + paper book.

## 6. Pre-Go-Live Drill (blocking, proof artifact required)
1. Fresh/spare PC → install → restore from each configured target → `hash-equal` screenshots + `drill_report.json` (counts, hashes, duration, operator names).
2. Deliberate break: wipe original test DB → restore → prove reports regenerate identical hashes.
3. File artifact in `/e2e/reports/phase8/<school>/drill_<date>.json` + head signs paper form. Hub records `drill_passed_at`; Go-Live unlocks only after this.
4. Repeat termly (sample) + after any hardware change.

## 7. Keys & Recovery Phrase
- Hub generates Ed25519+X25519 on first install. Privkeys in OS store (DPAPI/libsecret). **Recovery phrase (24 words) printed once**, split custody: Head holds sealed envelope A, Admin holds B (or safe + bank). Never photograph/WhatsApp it.
- **Re-key (new hub keys):** Settings → Keys → "Rotate" → prints new phrase → old key added to trust list (old reports still verify) → re-pair devices → revoke old device sessions.
- **Key loss:** enter recovery phrase on new install → decrypt latest backup → rotate to fresh keys → drill again. If phrase also lost: data unrecoverable by design — restore from USB plaintext? There is none. Emphasize custody in training.

## 8. Theft / Fire Response (one page for wall)
1. Call: revoke hub + all devices (Head phones support with school code; support revokes vault access + relay routing).
2. Buy/borrow replacement PC → install → restore from off-site USB or vault (phrase required).
3. Re-pair teacher phones (old pairings dead). Re-run drill. File incident note.
4. RTO target: <24h with USB, <48h vault-only.

## 9. Updates & Rollback
- Updates signed (offline root). Hub stages → verifies → swaps → health-checks (DB open + engine self-test). Fail → auto-rollback to prior binary + DB snapshot. Never auto-update in report week without admin confirm.

## 10. Troubleshooting Matrix
| Symptom | Cause | Fix |
|---|---|---|
| Backup hash mismatch | disk failing / RAM / interrupted write | retry, `integrity_check`, swap disk, file support bundle |
| USB not seen | FAT32 4GB limit / bad port | reformat exFAT, try rear ports, second stick |
| Vault PUT fails | offline / quota | queue retry, LAN/USB backup first, contact support with school code only (no PII) |
| Restore counts differ | wrong backup selected | compare manifest dates, pick latest verified, verify-only again |

## 11. Paper Forms (append)
F-1 Backup log (date, target, id, by whom, location). F-2 Drill certificate (hashes, counts, signatures). F-3 Key custody receipt.
*End — no live term without §6 artifact. Auditor checks this file + artifacts in Phase 8.*
