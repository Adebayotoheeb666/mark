# Agent Mark — Implementation Plan
## Local-First School Records & Report-Card System (No-AI)
### Execution Strategy: Plan → Build → Test → Document → Repeat (per phase)

**Source docs:** `Agent_Mark_Ten_Year_Plan_No-AI.md`, `Agent_Mark_PRD.md` v1.0
**Date:** 2026-10-16
**Status:** Draft v1.0 for review
**Method:** Every phase below executes the same 5-step loop. No phase is "done" until its Repeat/gate criteria pass.

**The loop (applies to all phases):**
1. **Plan** — scope, tasks, acceptance criteria, risks, owners.
2. **Build** — implement smallest shippable increment.
3. **Test** — prove it works (automated + manual + adversarial).
4. **Document** — update runbooks, specs, and PRD traceability.
5. **Repeat** — demo, retro, fix gaps, and only then advance. If gate fails, repeat the loop.

---

## Table of Contents

- [Phase 0: Foundations & Tech Design](#phase-0-foundations--tech-design)
- [Phase 1: Calculation Engine (deterministic core)](#phase-1-calculation-engine-deterministic-core)
- [Phase 2: Validation / Checking Engine](#phase-2-validation--checking-engine)
- [Phase 3: Comment Bank](#phase-3-comment-bank)
- [Phase 4: Report-Card Generator + Approvals](#phase-4-report-card-generator--approvals)
- [Phase 5: Hub App + Admin Console + Local DB](#phase-5-hub-app--admin-console--local-db)
- [Phase 6: Teacher Companion App + LAN Sync](#phase-6-teacher-companion-app--lan-sync)
- [Phase 7: Relay ("Post Office") + E2E Encryption](#phase-7-relay-post-office--e2e-encryption)
- [Phase 8: Backup / Restore + Hardening + Security Review](#phase-8-backup--restore--hardening--security-review)
- [Phase 9: Pilot Deployment (10–30 schools, Y1–2)](#phase-9-pilot-deployment-1030-schools-y12)
- [Phase 10: One-Click Installer + Subscriptions (Y3–4)](#phase-10-one-click-installer--subscriptions-y34)
- [Phase 11: Private Collective Improvement Loop (Y5–6)](#phase-11-private-collective-improvement-loop-y56)
- [Phase 12: Gold Standard — Transparency + Audits (Y7–8)](#phase-12-gold-standard--transparency--audits-y78)
- [Phase 13: Ecosystem — Pack Marketplace + Licensing (Y9–10)](#phase-13-ecosystem--pack-marketplace--licensing-y910)
- [Cross-Phase Controls](#cross-phase-controls)
- [Master Milestone & Gate Summary](#master-milestone--gate-summary)

---

## Phase 0: Foundations & Tech Design

**Goal:** Lock decisions from PRD §19 so downstream phases build on stable ground.
**PRD trace:** §10 NFRs, §11 Architecture, §19 Open Questions.

### Plan
- Resolve 10 open questions: reference OS (propose Win10+ first, Ubuntu LTS second), rank/tie + rounding defaults, relay TTL grace (propose 30d unclaimed / 7d post-delivery), report signature format (Ed25519 + QR), roster ID scheme (school-scoped short-code + UUID), pricing sketch, language priority, MVP distribution (print-only), auditor selection.
- Define reference hardware (i3/4GB/128GB), repo layout, branching, CI, signed-build pipeline, issue templates.
- Confirm stack: Hub (Go/Rust backend + local web UI + SQLCipher), App (Flutter), Relay (Go/Rust + S3-compatible store), Reports (HTML→PDF), Packs (signed ZIP + semver).
- Write threat model v0 + data-flow diagram (hub/app/relay/backup, trust boundaries).
- Owners: Tech Lead + Product. Duration target: 2–3 weeks.

### Build
- Scaffold monorepo: `/hub`, `/engine`, `/app`, `/relay`, `/packs`, `/docs`, `/e2e`.
- Stand up CI: lint, unit, SAST, dependency scan, reproducible-build check, signed-artifact staging.
- Create synthetic demo dataset (no real PII) + JSON schemas for School/Term/Score/Result/Flag/Comment/Report.
- Stub pack format v0 + signature verify script.

### Test
- CI green on clean checkout; build reproducibility check (two machines → identical hash).
- Schema validation tests on demo data; pack sign/verify round-trip test.
- Architecture review with independent checker (not the builder).

### Document
- `TECH_DESIGN.md` (stack, diagrams, schemas, key management), `THREAT_MODEL_v0.md`, `DECISIONS.md` (ADR per §19 answer).
- Update PRD §19 → resolved/accepted.

### Repeat (gate to Phase 1)
- [ ] All §19 decisions recorded or explicitly deferred with owner + date.
- [ ] CI + signed stub artifacts working. If not, repeat Plan→Build with reduced scope (drop Linux/iOS stubs, keep Win+Android).

---

## Phase 1: Calculation Engine (deterministic core)

**Goal:** Pure, dependency-free engine: weights → totals → averages → grades → ranks.
**PRD trace:** FR-CALC-001–006, Rules CALC-*-01.

### Plan
- Spec inputs/outputs: assessments (max, weight), rounding (half-up, 1-dec avg), grade tables (pack-supplied), rank mode (competition "1224" default, dense optional).
- Define rule versioning: `engine semver + pack_id/pack_version → result.rule_version + input_hash`.
- Test plan: unit per rule + property tests (determinism, weight-sum, monotonicity, tie handling) + 10k randomized cases.

### Build
- Implement `calc` module: `weighted_avg`, `grade_map`, `rank`, `round`, `attendance_pct`. No I/O, no network, no floats where exactness matters (use integer tenths / decimal).
- Pack loader for `weights.json` + `grading_scales.json`; reject weights ≠100% with `VAL-WEIGHT-01`.
- `explain(result_id)` API returning inputs + rule IDs + versions.

### Test
- Unit: known vectors (CA40/Exam60, ties, boundary grades 69.5→70).
- Property: same inputs → same outputs; weight permutation invariance; rank tie correctness (fuzz ties).
- Perf: 1000 students × 10 subjects full recompute <60s on reference PC.
- Independent re-implementation spot-check (second person recomputes 100 cases in Excel/Python, must match 100%).

### Document
- `ENGINE_SPEC.md` (formulas, rounding, tie rules, error codes), rule catalog entries CALC-*, CHANGELOG.
- "Why this grade?" copy for UX-002.

### Repeat
- [ ] 100% seeded vectors pass, property tests pass, perf target met, independent check 100% match. Otherwise fix engine, add regression vectors, re-run.

---

## Phase 2: Validation / Checking Engine

**Goal:** Blocking + warning checks with human-in-the-loop disposition. Never auto-changes data.
**PRD trace:** FR-VAL-001–006, Rules VAL-*.

### Plan
- Finalize thresholds: VAL-JUMP-01 (±25 pts vs. prior-term mean, tunable), VAL-OUTLIER-01 (>3 SD review-only), VAL-COLSWAP-01 heuristic (whole-class CA≪Exam inversion), VAL-COMLEN-01.
- Design flag lifecycle: `open → corrected | confirmed-with-reason | escalated → resolved`, all logged.
- Seed error suite: out-of-range, missing, dup, weight-sum, jump, outlier, column-swap.

### Build
- Implement validators as pure functions returning `{rule_id, severity, explanation, suggested_action}` in plain language.
- Flag store + inbox APIs (filter by severity/class/subject, assign, bulk actions).
- Per-school threshold overrides with versioned config.

### Test
- Seeded suite: each rule fires on positives, stays silent on clean data; false-positive review on realistic noisy data.
- Adversarial: boundary values (max, max+1, 0, -1, empty, " 85 ", 85.5), duplicate submits with same vs. different values, mid-term threshold change → re-validation correct.
- Usability: 3 teachers triage 50 flags; measure time + mis-disposition rate.

### Document
- `VALIDATION_RULES.md` (thresholds, tuning guide, example messages), admin runbook for threshold changes.
- Log disposition semantics for metrics (precision = confirmed-errors / blocking flags).

### Repeat
- [ ] Blocking precision >90% on seeded + pilot-like data, explanations understood by non-engineers, no auto-mutation path exists (verified by code search + test). Else retune thresholds, rewrite copy, re-test.

---

## Phase 3: Comment Bank

**Goal:** Fast, teacher-controlled comments: filter → preview → edit → save.
**PRD trace:** FR-COM-001–006.

### Plan
- Taxonomy: subject × band (e.g., A/B/C/D/F or 5 bands) × trend (improving/stable/declining) × tone (encouraging/firm/formal).
- Seed bank: 15–25 sentences per subject-band minimum for pilot subjects; placeholder set `{name, subject, score, strength, next_step}`; min/max char guardrails per template.
- Local usage counters design (counts only, no PII exfil).

### Build
- Comment library store + picker API + interpolation + preview.
- Save modes: as-is / edited (store `template_id + final_text` + diff flag) / custom.
- Overflow guard blocks report with clear message (links to VAL-COMLEN-01).

### Test
- Interpolation fuzz (names with apostrophes, long names, missing fields → graceful fallback).
- Layout fit test: longest comment per template renders within report box; overflow correctly blocks.
- Teacher trial: time per comment, reuse rate, edit distance; target >60% reuse as-is/light-edit in pilot.

### Document
- `COMMENT_BANK_GUIDE.md` (taxonomy, writing standards, placeholder reference), starter bank CSVs + CHANGELOG.
- Pack integration notes (how packs extend bank).

### Repeat
- [ ] Coverage check (every band/trend/tone has ≥N options per pilot subject), fit tests pass, teacher trial meets time/usefulness bar. Else expand bank, shorten defaults, re-trial.

---

## Phase 4: Report-Card Generator + Approvals

**Goal:** Tamper-evident reports from verified records only; mismatch = abort, never print wrong numbers.
**PRD trace:** FR-REP-001–006, REP-INT-01–03, PRD App. B footer.

### Plan
- Template contract: fields bound to `ComputedResult` hashes only; no free-typed grades.
- Workflow: draft (DRAFT watermark) → teacher review → head approval → lock + sign → version chain on correction.
- Report ID, hash (SHA-256), Ed25519 signature + QR payload design; footer format per App. B.

### Build
- HTML→PDF pipeline (A4, ink-friendly, dyslexia font option), batch queue (`{Year}_{Term}_{Class}_{StudentID}.pdf`), per-student abort on hash mismatch.
- Approval APIs + lock semantics: concurrent edit invalidates draft → force regenerate.
- Synthetic-data preview mode (never real students).

### Test
- Integrity: mutate one source score post-draft → generation aborts for that student with reason; others unaffected.
- Approval: missing approval → lock refused + watermark present; correction → new version + re-approval required; old version retained.
- Print: A4 pagination, 200-report batch time, low-ink rendering, QR scan verifies hash.
- Signature: tampered PDF fails verification.

### Document
- `REPORT_SPEC.md` (template fields, footer, versioning, verification steps), print/distribution runbook (manual in MVP).
- Inspector one-pager: how to verify a report.

### Repeat
- [ ] All integrity/approval/print tests pass; 200-report batch ≤5s/student equivalent; QR verify works. Else fix pipeline, re-run mutated-source suite.

---

## Phase 5: Hub App + Admin Console + Local DB

**Goal:** Single-PC system of record: setup → roster → scores → flags → comments → reports, all offline.
**PRD trace:** FR-HUB-001–007, FR-IDN-001–003, §8 Data Model, UX-001–008.

### Plan
- Wizard steps: school → year/terms → classes/subjects/assessments → scales (or pack install) → roster CSV import (dry-run) → assignments → readiness checklist → backup gate → Go Live.
- RBAC matrix (Admin/Head/Teacher/IT-Viewer), PIN+password, auto-lock, hash-chained audit log.
- DB: SQLCipher, soft-delete, score versioning, append-only audit.

### Build
- Hub backend + local web console (auto-start on boot, localhost + LAN TLS with pinned cert).
- Roster CRUD + CSV dry-run report (dup/missing/orphan), readiness dashboard (blocking vs. warning).
- Health panel: storage, sync queue, relay status, backup status, versions.
- Hard gate: Go Live disabled until backup + restore drill logged (links Phase 8).

### Test
- E2E on reference PC: fresh install → wizard (≤15 min with guide) → import 1000-student CSV → full term cycle offline.
- RBAC: permission matrix tests; auto-lock; audit completeness (score edit shows before/after + actor).
- Crash recovery: kill mid-write → restart recovers with checksums, no silent loss.
- Usability: non-engineer install + setup observed; fix jargon/errors.

### Document
- `HUB_ADMIN_GUIDE.md`, `SETUP_WIZARD_SCRIPT.md`, `RBAC_MATRIX.md`, `AUDIT_LOG_SPEC.md`, wall-chart quick-start (1 page).
- Update `TECH_DESIGN.md` with final schema migrations.

### Repeat
- [ ] Wizard ≤15 min, import dry-run catches seeded roster errors, RBAC + audit pass, crash test clean, naive-user trial passes. Else simplify wizard, rewrite errors, re-trial.

---

## Phase 6: Teacher Companion App + LAN Sync

**Goal:** Phones as remote controls: offline entry → LAN sync preferred, queue + retry.
**PRD trace:** FR-APP-001–006.

### Plan
- Android-first (Android 9+, 2GB RAM), iOS second; encrypted store (SQLCipher), no plaintext PII.
- Pairing via LAN QR/short-code + Head/Admin approval; per-device keys, revocable.
- Entry sheets mirror hub max/weights; instant local range check; outbox with backoff.

### Build
- App: classes/subjects, entry sheets, flag inbox, comment picker/editor, approval confirm (PIN/biometric).
- LAN discovery (mDNS) + TLS pinning; outbox queue + conflict handling (server-wins with diff shown, teacher re-confirms).
- Low-data mode + compressed payloads (pre-encryption).

### Test
- Offline: airplane-mode entry → reconnect → merge correct; conflicts surfaced, never silently overwritten.
- Device: low-end phone keystroke <100ms, storage-encrypted verified, revoke → device locked out + re-key works.
- Field: 3 teachers × 1 week real entry; measure entry time, sync failures, flag resolution time.

### Document
- `TEACHER_APP_GUIDE.md` (pairing, entry, flags, comments, approvals), `PAIRING_RUNBOOK.md`, loss/theft steps.
- Update threat model (stolen-phone case).

### Repeat
- [ ] Offline→sync correctness 100%, revoke works, field trial entry faster than paper/Excel baseline. Else fix sync/conflict UX, re-trial.

---

## Phase 7: Relay ("Post Office") + E2E Encryption

**Goal:** Opaque store-and-forward for remote teachers; operator cannot read contents.
**PRD trace:** FR-RLY-001–006, SEC-003, PRI-001–004.

### Plan
- API: `POST /envelopes`, `GET /envelopes?forHub=`, `DELETE /envelopes/`; fields limited to routing_id/size/timestamps/expiry.
- Crypto: X25519 + XSalsa20-Poly1305 (NaCl box), hub keypair generated on-site, private key never leaves hub; per-device session keys via hub pairing.
- TTL: 30-day auto-delete unclaimed, ~7-day grace post-delivery; rate limits + abuse caps; aggregate-only throughput logs.

### Build
- Minimal relay (Go/Rust + object store + TTL sweeper); hub poller with backoff + "check now"; app sealed-send/receive.
- Sealed-reply path (hub → phone) over same mechanism.
- Dashboard relay status (reachable/queued/last-pull).

### Test
- Opacity: operator decryption attempt fails; DB/log grep finds zero PII/plaintext scores.
- TTL: unclaimed blob deleted ≈30d (accelerated-clock test + staging soak); delivered blob deleted after grace.
- Chaos: relay down → local compute/print unaffected; queued envelopes deliver on recovery in order; duplicates idempotent.
- Abuse: rate-limit + oversize + spam routing IDs rejected without leaking info.

### Document
- `RELAY_SPEC.md` (API, crypto, TTL, abuse handling), `RELAY_OPS_RUNBOOK.md`, privacy notice paragraph for parents (sealed envelopes, 30-day delete).
- Publish relay transparency counters definition (no content inspection).

### Repeat
- [ ] Opacity + TTL + offline-unaffected proofs pass; load test (pilot-scale envelopes) clean. Else rework crypto/metadata handling, re-audit logs.

---

## Phase 8: Backup / Restore + Hardening + Security Review

**Goal:** Mandatory survival: every school proves it can lose the PC and come back. No PII loaded until review passes.
**PRD trace:** FR-BKP-001–005, FR-IDN-001–002, SEC-001–006, Acceptance gate.

### Plan
- Backup targets: USB + on-site 2nd PC and/or operator vault (all ciphertext with school-held keys); daily-during-term + pre-report snapshot; hash per backup.
- Hardening: signed updates with rollback, auto-start, disk-full handling, clock-skew guards, dependency pinning.
- Review scope: hub, app, relay, crypto usage, pack loader, PDF pipeline; auditor engaged (not the builder).

### Build
- One-click backup + dry-run-verify restore (counts + hashes before overwrite); overdue escalation (>N days stale → Head/IT alert); Go-Live gate wiring.
- Recovery-phrase export (Head custody) + re-key flow; theft runbook (revoke + restore to new PC).
- Update channel with signature verify + rollback.

### Test
- **Restore drill (blocking):** wipe test machine → restore from each target → hash-equal + counts match; all pilots must pass before go-live.
- Key-loss drill: recovery phrase restores access; stolen-device revoke drill.
- Update: bad-signature update refused; failed update rolls back to bootable state.
- External review: findings triaged (critical/high block go-live), remediated, re-tested.

### Document
- `BACKUP_RESTORE_RUNBOOK.md`, `KEY_MANAGEMENT.md`, `UPDATE_ROLLBACK.md`, `THEFT_RESPONSE.md`.
- Auditor report filed + remediation log; update `THREAT_MODEL.md` to v1.

### Repeat (hard gate to pilot)
- [ ] 100% drill pass, review criticals/highs closed, rollback proven. **If any fail, do not load real student data — repeat this phase.**

---

## Phase 9: Pilot Deployment (10–30 schools, Y1–2)

**Goal:** Prove time saved + correctness + trust in real schools with shaky internet and ordinary PCs.
**PRD trace:** §16 Y1–2, §17 KPIs, §20 Acceptance.

### Plan
- Recruit 10–30 diverse pilots (urban/rural, sizes, connectivity); free/discounted terms + success criteria contract.
- Per-school plan: install → wizard → drill → first-term mandatory human approval on every report → survey teachers/parents.
- Instrumentation (local-only): cycle time, flag precision, comment reuse, backup health. No PII to cloud.
- Support: <24h first response, on-call rotation, issue severity tiers.

### Build
- Pilot tooling: installer USBs, demo-data reset, per-school config packs, printed quick-starts, survey forms (paper + offline).
- Support desk + status page (aggregate only) + escalation to engineering.

### Test (in production pilot)
- First-term: 100% reports human-approved; independent re-check sample 100% match; mutated-source guard active.
- Measure: median cycle 3 days → <1 hr; blocking precision >90%; comment reuse >60%; drill 100% pass; zero PII egress (hub + relay log audit).
- Chaos in field: power cut mid-entry, PC theft simulation (spare), relay outage week — all recovered via runbooks.

### Document
- Per-school pilot report (local metrics + quotes + issues); global `PILOT_READOUT.md` with go/no-go for Y3–4.
- Update all runbooks with field lessons; file regulator/inspector FAQ from real questions.

### Repeat
- [ ] Exit: median <1 hr, 100% correctness sample, 0 egress, 100% drill, ≥70% pilots intent to renew/convert. If missed, fix top 3 friction causes (likely wizard, flag noise, print layout) and run a second term — do not scale prematurely.

---

## Phase 10: One-Click Installer + Subscriptions (Y3–4)

**Goal:** A non-engineer (IT teacher / senior student) can install unassisted; business becomes real.
**PRD trace:** §16 Y3–4, §14 Packs, §15 Monetization.

### Plan
- Installer: single download/USB, self-test, rollback; commodity-PC certification list.
- Billing: annual tiers (<200 / 200–800 / 800+ students), pack add-ons, backup vault per-GB; pilot conversion offers.
- First anonymous stats: define buckets + k-thresholds with auditor (e.g., ≥20 schools/bucket); below threshold → collect nothing.

### Build
- One-click installer + updater; license activation (offline-capable key, no PII in license call).
- Billing + support tiers + SLAs (<4h paid response target); pack store v1 (2–3 core packs + 1–2 paid exam-board packs).
- Threshold-gated aggregate counter (counts only: check hit-rates, template ranks, install counts).

### Test
- Naive-installer trial: unassisted success >90%; time-to-live measured.
- Billing: offline activation, grace on expiry (never locks exam-week reports without warning + override).
- Stats gate: below-threshold → zero upload (verified by network capture); above-threshold → only allowed buckets upload.

### Document
- `INSTALL_GUIDE.md` (1-page + video script), `BILLING_TERMS.md` (plain language), `PACK_STORE_GUIDE.md`, `ANONYMOUS_STATS_SPEC.md` (buckets, thresholds, retention).
- Publish pricing plainly.

### Repeat
- [ ] Install >90% unassisted, NRR positive trend, support load/school declining, stats gate proven. Else simplify installer/packaging, re-trial with new naive users.

---

## Phase 11: Private Collective Improvement Loop (Y5–6)

**Goal:** Every school benefits from blurred patterns; no school identifiable; expand institution types.
**PRD trace:** §16 Y5–6, PRI-001–003, PACK-004.

### Plan
- With auditor: finalize N/M thresholds, bucket design, noise/bucketing review; manual-pack-improvement fallback if thresholds unmet.
- New segments: universities, training centers, tutoring (GPA packs, transcript templates).
- Candidate improvements: top common-error checks, comment-bank winners → revised packs.

### Build
- Aggregate pipeline (threshold-enforced, differentially-private or binned where needed) → pack candidate generator → human curation → signed pack release.
- Segment packs: GPA/transcript variants, attendance variants.

### Test
- Privacy: small-cell suppression verified; re-identification review (can any bucket single out a school? if yes, suppress).
- Efficacy: new checks lift flag precision without recall loss on held-out pilot data; comment pack A/B (teacher preference + reuse rate).
- Segment: university pilot transcribes correctly per GPA pack.

### Document
- `AGGREGATE_PRIVACY_SPEC.md` (thresholds, buckets, retention, auditor sign-off), `PACK_CHANGELOG.md` per release, segment guides.
- Transparency note: what was counted, what was never collected.

### Repeat
- [ ] Auditor sign-off + measurable precision/reuse lift + zero identifiability findings. Else suppress more, collect less, re-review — never relax thresholds to hit a roadmap date.

---

## Phase 12: Gold Standard — Transparency + Audits (Y7–8)

**Goal:** Anyone (parent, inspector, journalist) can check our homework; regulators cite us as exemplar.
**PRD trace:** §16 Y7–8, SEC/PRI full.

### Plan
- Plain-language publication set: architecture, crypto, rules, privacy proofs, relay opacity demo.
- Audit scope: security + privacy + reliability (restore sampling); select firms; pre-commit remediation window.
- Regulator engagement: at least one jurisdiction exemplar track.

### Build
- Transparency portal (no PII): specs, rule versions, audit reports, remediation log, verification tools (report QR checker, pack signature checker).
- Reproducibility kit: demo data + engine + expected outputs so third parties can re-run.

### Test
- Third-party reproduction: outsiders reproduce calc/report/relay-opacity claims from published kit.
- Audit execution + finding closure; restore sampling across live schools.
- Red-team: "prove you can read student data" challenge (expected: cannot).

### Document
- Publish all reports + remediation log; `REGULATOR_BRIEF.md`; press/inspector FAQ.
- Freeze gold-standard spec versions with hashes.

### Repeat
- [ ] Audits pass, reproduction succeeds, ≥1 regulator exemplar/inbound pilot. Else address findings publicly and re-audit — no silent fixes.

---

## Phase 13: Ecosystem — Pack Marketplace + Licensing (Y9–10)

**Goal:** Others build on top; blueprint licensed to adjacent domains without weakening guarantees.
**PRD trace:** §16 Y9–10, PACK-005.

### Plan
- Marketplace: third-party pack SDK, review/certification, revenue share; country/subject coverage targets.
- Licensing: privacy-first derivatives for clinics/law/local-gov (separate products, same hub+sealed-relay pattern); partner selection criteria.
- Governance: certification rules, revocation for violating packs/partners.

### Build
- Pack SDK + validator + signing + store + reviews; partner reference implementation + conformance suite (opacity + determinism + restore tests).
- Versioned APIs with 2-year support windows.

### Test
- Conformance: partner impl must pass opacity/TTL/restore/determinism suites to stay certified.
- Marketplace: malicious-pack rejection (oversize, code execution, PII exfil attempt) verified.
- Backward compat: old packs still verify + generate identical outputs.

### Document
- `PACK_SDK.md`, `CERTIFICATION_RULES.md`, `PARTNER_BLUEPRINT.md`, marketplace terms (plain language).
- Ecosystem map + support boundaries.

### Repeat
- [ ] SDK adopted by ≥N external pack authors, ≥1 licensed domain live and conformant, no conformance bypass open. Else tighten review/conformance, re-test.

---

## Cross-Phase Controls

**Run every phase, every loop:**

| Control | How |
|---|---|
| Independent check | Each phase's Build verified by someone other than the builder (pair swap / external for Phases 8, 11, 12). |
| No-AI guardrail | No ML/generative component merged without separate PRD + privacy review + opt-in. CI label check. |
| Zero-knowledge invariant | Relay/store grep tests for PII in every CI run; any hit blocks merge. |
| Determinism | Engine property tests in every CI run; golden vectors versioned. |
| Backup gate | No live-data milestone without drill proof artifact. |
| Plain language | Every user-facing string + error reviewed for jargon; naive-user read-through per phase. |
| Traceability | Each task links to PRD FR ID; each release notes PRD coverage delta. |

---

## Master Milestone & Gate Summary

| Gate | Criteria (must all pass to advance) |
|---|---|
| G0 → G1 | §19 decisions recorded; CI + signed stubs green |
| G1 → G2 | Engine vectors + property + perf pass; independent 100% match |
| G2 → G3 | Seeded error suite pass; precision >90% trajectory; no auto-mutate path |
| G3 → G4 | Bank coverage + fit + teacher trial pass |
| G4 → G5 | Mismatch-abort + approval + print/QR pass |
| G5 → G6 | Wizard ≤15 min; RBAC/audit/crash pass; naive-user trial pass |
| G6 → G7 | Offline→sync + revoke + field trial pass |
| G7 → G8 | Opacity + TTL + outage-unaffected proofs pass |
| **G8 → Pilot** | **Drill 100% + external review criticals/highs closed + rollback proven (HARD GATE)** |
| Pilot → Y3–4 | Median <1 hr; 100% sample correctness; 0 egress; ≥70% renew intent |
| Y3–4 → Y5–6 | Install >90% unassisted; billing live; stats gate proven |
| Y5–6 → Y7–8 | Auditor sign-off; precision/reuse lift; zero identifiability |
| Y7–8 → Y9–10 | Audits pass; reproduction succeeds; regulator exemplar |
| Y9–10 done | SDK adoption + conformant licensed domain live |

---

*End of Implementation Plan v1.0. Next: open `DECISIONS.md`, assign owners/dates per Phase 0–1, and start the first Plan → Build → Test → Document → Repeat loop.*
