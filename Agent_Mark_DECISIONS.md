# Agent Mark — Decisions (ADRs)
**Status:** Draft v1.0 | **Resolves:** PRD §19 | **Required for:** Phase 0 gate (G0→G1)

Format per ADR: Context → Options → Decision → Consequences. Status: Accepted unless marked Proposed.

## ADR-001: Reference OS Floor
- **Context:** PRD §19 Q1. Limited eng capacity; pilot hardware unknown.
- **Options:** (a) Win10+ only, (b) Win10+ + Ubuntu LTS from day one.
- **Decision:** (a) **Windows 10+ 64-bit first.** Ubuntu 22.04 LTS second as build-flavored binary with best-effort support, no GUI installer polish until Y3.
- **Consequences:** CI builds both; e2e on Windows reference PC is blocking, Linux advisory until Phase 10.

## ADR-002: Rank, Tie & Rounding Defaults
- **Context:** PRD §19 Q3. Must match exam-officer expectations.
- **Decision:** Default **competition rank ("1224")**, ties share position, next rank skips. **Totals integer; averages 1-decimal half-up.** Pack-overridable (dense rank option). Footer always prints rule + pack version.
- **Consequences:** Engine + templates implement both rank modes; flag if pack omits tie rule.

## ADR-003: Relay TTL & Grace
- **Context:** PRD §19 Q4. Ten-year plan says ~30 days.
- **Decision:** **30 days unclaimed → auto-delete. 7-day grace after delivery ACK, then delete.** Abuse-held blobs max 30 days. Sweeper hourly.
- **Consequences:** Relay stores expiry per envelope; hub re-sends if no ACK within retry window (idempotent op_ids).

## ADR-004: Report Signature & Verification
- **Context:** PRD §19 Q5.
- **Decision:** **Ed25519 detached signature by hub key + SHA-256 hash + QR** encoding `AGM1:{report_id}:{hash_hex}:{sig_b64}:{hub_pubkey_fp}`. Offline verify via printed hash; online verify via inspector tool pastes QR string.
- **Consequences:** Reports pipeline + inspector one-pager must implement verify; key rotation appends to trust list, never rewrites old reports.

## ADR-005: Roster ID Scheme
- **Context:** PRD §19 Q6.
- **Decision:** **Dual ID:** internal UUID + human short-code `{YEAR}-{CLASS}-{NNN}` (e.g., `26-JSS2A-014`), school-scoped, immutable once assigned. CSV import matches on short-code or UUID.
- **Consequences:** All PDFs/filenames use short-code; UUID in DB/API.

## ADR-006: Pricing & Pilot Terms (sketch for validation)
- **Context:** PRD §19 Q7.
- **Decision (proposed, validate with 5 heads pre-build):** Annual tiers **<200 / 200–800 / 800+ students**; pilots free Year 1, 50% Year 2 if they co-run surveys + drills. Packs: core free, exam-board packs paid. Vault per-GB/mo. Never charge per-report or for data export.
- **Consequences:** Billing deferred to Phase 10, but license-key format (offline-capable) fixed now so Hub can stub it.

## ADR-007: Language Priority
- **Context:** PRD §19 Q8.
- **Decision:** **English first; French second** (pack structure supports it). Nigerian-language comment packs (Yoruba/Hausa/Igbo) via paid/community packs in Y3+, not blocking MVP.
- **Consequences:** All strings externalized from day one; comment CSVs carry `locale` column.

## ADR-008: Parent Distribution in MVP
- **Context:** PRD §19 Q9.
- **Decision:** **Print + admin-managed handoff only in MVP.** No auto-email/SMS of PII. PDF export allowed to admin USB only, logged. Parent portal deferred post-MVP.
- **Consequences:** No notification service in MVP scope; report leakage surface limited to physical/admin handling (covered in runbook).

## ADR-009: Auditor & Review Scope
- **Context:** PRD §19 Q10.
- **Decision:** Engage **one external firm pre-PII** covering hub, app, relay, crypto usage, pack loader, PDF pipeline. Criticals/highs block pilot. Re-test required. Budget line held in Phase 8.
- **Consequences:** Auditor SOW must be signed before Phase 8 Build; no real student data before remediation log closed.

## ADR-010: Anonymity Thresholds (initial, auditor to ratify)
- **Context:** PRD PRI-001, §19 implicit.
- **Decision (proposed):** No aggregate upload unless **≥20 schools AND ≥500 students per bucket**, bucket = (check_id × term) or (template_id × band). Small cells suppressed. Below threshold → local-only, manual pack curation.
- **Consequences:** Phase 10 stats module ships with gate hard-coded + network-capture test; auditor may raise N/M, never lower without new ADR.

## Deferred (explicit)
- D-01 Multi-hub failover → post-MVP (manual restore only).
- D-02 Parent portal → post-MVP with separate privacy review.
- D-03 Any ML/AI → separate PRD + opt-in, forbidden by default (CI guard).
*End — add new ADRs append-only; never rewrite accepted ones, supersede with new number.*
