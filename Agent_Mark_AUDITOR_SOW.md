# Agent Mark — External Audit Statement of Work (Pre-PII Gate)
**Status:** Draft v1.0 for procurement | **Blocks:** pilot PII load (Phase 8) | **Refs:** PRD SEC-001–006, THREAT_MODEL §5

## 1. Objective
Independent review proving: (a) student PII cannot be read by relay/operator, (b) calculations/validations/reports behave as specified, (c) backups/updates/keys survive standard attacks and failures.

## 2. Scope (in)
- Hub binary + installer, local web console, engine (calc/validation), pack loader, PDF/sign pipeline, backup/restore, updater.
- Teacher app (Android), pairing, encrypted store, revoke.
- Relay API + store + sweeper + logging (opacity + TTL + abuse controls).
- Crypto usage: keygen/storage, NaCl box, Ed25519, SQLCipher, random, TLS pinning.
- Docs: TECH_DESIGN, DATA_MODEL_RULES, THREAT_MODEL, BACKUP_RUNBOOK, parent notice.

## 3. Out of Scope
- Social engineering of schools, physical intrusion beyond stolen-disk scenario, DDoS beyond rate-limit validation, iOS build (advisory only).

## 4. Access Provided
Source + build scripts, reference PC + low-end Android, relay staging with test keys, synthetic demo data + seeded errors, architecture walkthrough (4h), threat model v1.

## 5. Methodology (min)
Architecture review → code review (crypto/auth/sync/restore paths 100%) → DAST/SAST → manual pentest → opacity challenge ("decrypt this vault/relay dump") → TTL/replay/abuse tests → restore/rollback drills witnessed → re-test after fixes.

## 6. Deliverables
1. Findings register (Critical/High/Med/Low with repro, impact, fix guidance). 2. Opacity opinion letter (can/cannot read PII + why). 3. Remediation re-test note. 4. Public-summary paragraph (publishable, no internals).

## 7. Acceptance & Timeline
- 3–4 weeks review + 2 weeks remediation + 1 week re-test (target). **Pilot PII blocked until Criticals + Highs closed + re-tested.**
- Acceptance: all scope items tested, opinion letter delivered, public summary approved.

## 8. Vendor Requirements
- No PII access needed; test data synthetic. Conflicts disclosed. CVEs + tooling listed. Fixed fee + re-test included.
- Sign: NDA (protects source, permits publishing summary + remediation log).

## 9. Evaluation Criteria (for selecting firm)
Edu/gov privacy experience 30%, applied-crypto + mobile + cloud review depth 30%, plain-language reporting 20%, fixed-fee + timeline 20%.
*Attach: PRD, TECH_DESIGN, THREAT_MODEL, TEST_STRATEGY when issuing RFQ.*
