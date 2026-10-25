# Agent Mark — Threat Model & Privacy Spec
**Status:** Draft v1.0 | **Gates:** Phase 7–8, pilot PII | **Owner:** Tech Lead + Auditor

## 1. Trust Boundaries & Assets
- **Trusted:** Hub PC (if hardened + encrypted), paired teacher phones (if encrypted + revocable), school admins.
- **Untrusted:** Network (school Wi-Fi, ISP), Relay operator + host, stolen devices, curious insiders.
- **Assets:** student PII + grades (critical), hub/app keys, audit log, backups, report PDFs.

## 2. Threats & Mitigations
| # | Threat | Mitigation | Test |
|---|---|---|---|
| T1 | Hub stolen / seized | SQLCipher at rest; OS-store keys; auto-lock; revoke + restore to new PC via recovery phrase; theft runbook | Steal-sim: disk image without key yields nothing |
| T2 | Phone lost | Encrypted store; per-device revoke + re-key; remote lockout on next sync; no bulk export on device | Revoke drill: device locked out in <1 sync cycle |
| T3 | Malicious / hacked Relay | E2E NaCl box; relay holds only nonce+ciphertext + routing metadata; TTL delete; no key escrow | Operator-decrypt challenge must fail; log grep zero PII |
| T4 | Network attacker (sniff/replay) | TLS 1.3 + E2E inner box; nonces + op_id idempotency; cert pinning on LAN | Replay captured envelope → rejected as duplicate |
| T5 | Insider teacher alters grades | RBAC scoping; score versioning (no silent overwrite); hash-chained audit; dual approval for locks | Audit shows before/after + actor; tamper breaks chain |
| T6 | Backup theft | Backups age-encrypted with school key; operator vault opaque; manifest signed | Decrypt without school key fails |
| T7 | Malicious pack / update | Ed25519 verify; dry-run; atomic + rollback; term-pin | Bad-sig pack/update refused; rollback boots |
| T8 | Ransomware / disk failure | Dual copy + tested restore; offline USB copy; versioned snapshots | Wipe→restore hash-equal drill |

## 3. Privacy Rules (normative)
- **P1:** Relay + operator cannot decrypt PII by construction (no keys, no plaintext fields). Verified per release.
- **P2:** No per-student telemetry leaves hub. Aggregates only if **≥20 schools AND ≥500 students/bucket** (ADR-010); else collect nothing.
- **P3:** Allowed aggregates: install counts, template usage ranks, check hit-rates per (check×term) bucket. Forbidden: names, scores, small cells, per-school breakdowns.
- **P4:** Retention: relay blobs 30d/7d grace; aggregate buckets per-term then delete raw counts; audit logs stay at school.
- **P5:** Parent notice (plain language): what stays at school, sealed-envelope relay + 30-day delete, correction/erasure rights, who to contact.

## 4. Key Management
- Hub Ed25519+X25519 generated on-site; privkeys in OS store; encrypted paper recovery phrase (Head + Admin split custody recommended).
- Device keys per phone; revocation list on hub; re-key flow tested in Phase 8.
- Release root key offline; rotation appends trust, never rewrites history.

## 5. Pre-PII Gate Checklist
- [ ] External review criticals/highs closed + re-tested
- [ ] Opacity (decrypt-fail) + TTL + replay tests pass
- [ ] Restore + revoke + rollback drills pass with artifacts
- [ ] Parent notice + consent/erasure workflow signed off
*End — auditor must countersign §5 before pilot loads real data.*
