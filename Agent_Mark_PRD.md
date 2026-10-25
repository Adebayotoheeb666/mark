# Agent Mark — Product Requirements Document (PRD)
## Local-First School Records & Report-Card System (No-AI Version)

**Document status:** Draft v1.0 for review
**Source:** `Agent_Mark_Ten_Year_Plan_No-AI.md` — "Keep-It-On-The-School-PC" version
**Date:** 2026-10-16
**Author:** Product (generated from ten-year plan)
**Audience:** Engineering, Design, Security, Operations, Pilot Schools, Regulators

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Background & Problem Statement](#2-background--problem-statement)
3. [Goals, Non-Goals & Principles](#3-goals-non-goals--principles)
4. [Personas & Stakeholders](#4-personas--stakeholders)
5. [Scope](#5-scope)
6. [User Journeys & Use Cases](#6-user-journeys--use-cases)
7. [Functional Requirements](#7-functional-requirements)
8. [Data Model](#8-data-model)
9. [Business Rules Catalog](#9-business-rules-catalog)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Architecture & Proposed Tech Stack](#11-architecture--proposed-tech-stack)
12. [Security & Privacy Requirements](#12-security--privacy-requirements)
13. [UX / UI Requirements](#13-ux--ui-requirements)
14. [Rule & Template Packs (Marketplace)](#14-rule--template-packs-marketplace)
15. [Monetization & Business Model](#15-monetization--business-model)
16. [Ten-Year Phased Rollout](#16-ten-year-phased-rollout)
17. [Success Metrics & KPIs](#17-success-metrics--kpis)
18. [Risks, Trade-Offs & Mitigations](#18-risks-trade-offs--mitigations)
19. [Open Questions & Decisions Needed](#19-open-questions--decisions-needed)
20. [Acceptance Criteria & Definition of Done](#20-acceptance-criteria--definition-of-done)
21. [Appendices](#21-appendices)

---

## 1. Executive Summary

Agent Mark (Local-First, No-AI) is a deterministic school records system that lives on a computer the school owns in its own admin office. It automates the boring, error-prone work of report-card season — totaling scores, computing averages/grades/positions, catching data-entry mistakes, assembling teacher-approved comments, and producing tamper-evident report cards — **without sending any identifiable student data to the cloud, ever.**

Key properties:

- **Local-first:** All student PII and grades are stored and processed on the school hub PC. The internet is used only as a message transport.
- **Deterministic, explainable:** No ML/AI generation. All calculations, flags, and comment insertions follow auditable rules. Same inputs always produce same outputs, with a visible "why."
- **Phone-as-remote:** Teachers use a mobile companion app to enter scores, pick/edit comments, and approve reports. The app talks directly to the hub over LAN when possible, or via an opaque encrypted relay ("post office") when remote.
- **Zero-knowledge relay:** A minimal cloud relay stores only sealed, end-to-end encrypted envelopes it cannot open, with ~30-day TTL then auto-delete.
- **Trust-first business:** Monetization follows the WhatsApp model — charge for service (subscription, packs, setup, encrypted backup), never for data. The operator cannot read student data by design, not by promise.

One-sentence summary from the ten-year plan: *a reliable report-card system that lives at the school, never sends real student data anywhere, gets more useful over time by counting general patterns (not private details) across schools, and makes money by charging for the service around the private data.*

---

## 2. Background & Problem Statement

### 2.1 Current state

Most schools manage grades/attendance/report cards in one of two fragile ways:

1. **Paper + Excel sprawl:** Manual totaling, inconsistent grading scales, copy-paste errors, lost files, 2–3 days per term to reconcile report cards.
2. **Foreign SaaS:** Student data sits on a vendor's server the school doesn't own, can't inspect, and can't fully delete. Requires reliable internet, creates regulatory and parental-trust exposure.

### 2.2 Pain points

- **Teachers:** Repetitive arithmetic, hunting missing scores, writing hundreds of unique comments under time pressure.
- **Admins / Heads:** No single source of truth; late detection of errors; inconsistent layouts across classes/terms.
- **Parents / Regulators:** Cannot verify correctness or privacy; "trust us" cloud promises.
- **IT:** Poor connectivity environments; low budgets; no dedicated staff; ordinary office hardware only.

### 2.3 Opportunity

A system that runs on one ordinary office PC, works offline, enforces school rules automatically, and provably keeps data on-site can cut report-card production from **~3 days to <1 hour per cycle** while earning trust that cloud competitors cannot match.

---

## 3. Goals, Non-Goals & Principles

### 3.1 Product goals (Years 1–2 pilot)

1. Correct, auditable computation of totals, averages, grades, and ranks.
2. Early detection of data-entry errors and anomalies with human-in-the-loop resolution.
3. Fast, consistent report-card production from verified records only.
4. Teacher-controlled comments via editable comment bank (no auto-generated prose).
5. Offline-capable operation on commodity hardware with mandatory, proven backup/restore.
6. Zero student PII leaving the school unencrypted; operator inability to read relay payloads.

### 3.2 Non-goals (explicitly out of scope for No-AI version)

- No ML/AI grading, prediction, or free-text comment generation.
- No cloud student database, analytics dashboard over PII, or cross-school PII sharing.
- No parent/student portal in MVP (reports distributed as signed PDF/print; portal is post-MVP).
- No attendance biometrics, fee management, or LMS features in MVP.
- No custom hardware; no GPU/server requirements.

### 3.3 Principles

1. **Local-first, always.** PII at rest and in processing stays on the school hub.
2. **Determinism over cleverness.** Every output traceable to a rule + inputs.
3. **Human approves.** No report ships without teacher/admin approval in pilot; automation assists, never overrides.
4. **Prove it, don't promise it.** External security review, restore drill, published logic, independent audits.
5. **Boring technology wins.** Commodity PC, single-install package, minimal cloud surface.
6. **Service, not surveillance.** Revenue from software/service/packs, never from data sale or ads on PII.

---

## 4. Personas & Stakeholders

| Persona | Description | Core needs |
|---|---|---|
| **Class Teacher** | Enters scores for 1–6 subjects, writes/approves comments | Fast entry on phone, offline, clear error flags, quick comment pick + edit |
| **Subject Teacher** | Enters scores for one subject across many classes | Bulk entry, import, cross-class consistency |
| **Head of School / Principal** | Accountable for correctness and parent trust | One-click approval, audit trail, backup assurance |
| **Admin / Exams Officer** | Configures terms, scales, templates; prints/distributes | Setup wizard, rule packs, template preview, bulk print/export |
| **School IT / Power User** | Installs and maintains hub (may be a teacher or senior student) | One-click installer, health dashboard, backup status |
| **Parent / Guardian** | Receives report card | Legible, consistent report; confidence it is correct and private |
| **Regulator / Inspector / Journalist** | Verifies claims | Plain-language docs, reproducible logic, audit access |
| **Agent Mark Operator** | Runs relay + pack distribution + support | Minimal-knowledge ops, anonymous aggregate counts only |
| **External Auditor** | Independent security/privacy review | Source + architecture + test access, no PII needed |

---

## 5. Scope

### 5.1 MVP scope (pilot: 10–30 schools, Years 1–2)

**In:**

- School hub application (Windows-first, Linux support if low-cost) on single office PC.
- Local database (encrypted at rest), calculation engine, validation engine, comment bank, report generator (PDF + print).
- Admin console (on hub) for school setup, users, terms, subjects, scales, templates.
- Teacher companion app (Android-first, iOS second; must support low-end devices) for score entry, flags resolution, comment selection/editing, approvals.
- LAN-first sync + encrypted relay fallback with 30-day TTL.
- Mandatory backup (on-site second copy and/or encrypted cloud backup) + restore drill gate.
- Rule/template pack installer (country/exam-board/subject packs v1).
- Audit log, role-based access, signed report outputs.

**Out (deferred):**

- Parent/student portal, SMS/email distribution automation (manual export in MVP).
- Multi-hub clustering / automatic failover (manual restore in MVP).
- Cross-school federated learning beyond manual anonymous counts (Years 5–6).
- Public transparency portal and formal certification (Years 7–8).
- Third-party pack SDK and cross-domain licensing (Years 9–10).

### 5.2 Phased scope summary

| Phase | Focus | Adds |
|---|---|---|
| Y1–2 | Prove it works | Hub + app + relay + backup gate + pilot |
| Y3–4 | Easy install anywhere | One-click installer, hardened ops, paid subs, first anonymous stats |
| Y5–6 | Schools help each other | Threshold-gated aggregate improvement loop, more institution types |
| Y7–8 | Gold standard | Plain-language specs, independent audits, regulator recognition |
| Y9–10 | Ecosystem | Pack marketplace, SDK, licensed privacy-first derivatives (health/legal/gov) |

---

## 6. User Journeys & Use Cases

### UC-1: Term setup (Admin)
1. Admin runs setup wizard: school profile → academic year → terms → classes → subjects → grading scale (or installs pack, e.g., WAEC/NECO/British/American).
2. Admin imports or enters student roster (CSV/manual), assigns teachers to classes/subjects.
3. System validates roster (duplicate names, missing IDs, orphan assignments) and shows readiness checklist.
4. Gate: backup configured + restore drill passed before "Go Live" unlocks.

### UC-2: Score entry (Teacher)
1. Teacher opens app, sees assigned classes/subjects and entry sheets with max scores pre-filled.
2. Teacher enters scores offline; app validates locally (range, type) and queues encrypted sync.
3. On sync (LAN or relay), hub merges, re-validates globally, flags conflicts/missing entries.
4. Teacher resolves flags (correct, confirm as-is with reason, or escalate).

### UC-3: Validation & correction loop
1. Hub runs checks (see §9): range, missing, sudden-jump vs. student history, class-outlier review.
2. Flag inbox shows: student (pseudonymized where appropriate), subject, assessment, value, rule triggered, explanation, suggested action.
3. Teacher corrects or confirms with note; all actions logged with actor + timestamp.

### UC-4: Comments
1. Teacher filters comment bank by subject → performance band → trend → tone.
2. System fills placeholders (`{first_name}`, `{subject}`, `{strength}`, `{next_step}`).
3. Teacher edits freely; edited text is what ships. System tracks usage counts (for future pack improvement, anonymously).

### UC-5: Report generation & approval
1. Admin triggers draft reports for term. Engine pulls only from verified records; any unresolved blocking flag blocks that student's report with a clear reason.
2. Teachers review/approve their class reports (mandatory in first grading period of pilot).
3. Head approves batch; system emits numbered, signed PDFs + print batch. Hash recorded in audit log.
4. Distribution is manual in MVP (print/handout or admin-managed file share). No auto-emailing of PII.

### UC-6: Remote entry via relay (teacher at home)
1. App encrypts payload to hub's public key, uploads sealed envelope to relay.
2. Relay holds opaque blob (no metadata beyond routing + expiry). Hub polls and pulls when online.
3. Hub decrypts locally, processes, and (if needed) replies via same sealed-reply mechanism.
4. Relay auto-deletes after ~30 days / after confirmed delivery + grace window.

### UC-7: Backup & restore
1. Scheduled encrypted backup to USB/second PC and/or operator cloud vault (both encrypted with school-held keys).
2. Health dashboard shows last success, size, integrity check.
3. Termly restore drill (at least pre-go-live): wipe test machine → restore → verify counts/hashes match.

---

## 7. Functional Requirements

ID convention: `FR-<area>-<###>`. Priority: **M**ust / **S**hould / **C**ould.

### 7.1 School Hub — Core & Admin Console

- **FR-HUB-001 (M):** Single-PC hub app installable on commodity Windows 10+ office PC (4GB RAM minimum target, no GPU). Linux support S/C.
- **FR-HUB-002 (M):** Setup wizard: school profile, year/terms, classes, subjects, assessments with weights, grading scales, attendance config.
- **FR-HUB-003 (M):** Roster management: add/edit/archive students, staff, assignments; CSV import with dry-run validation report.
- **FR-HUB-004 (M):** Role-based access (Admin, Head, Teacher, IT/Viewer) with least privilege; PIN + password; auto-lock; per-action audit log.
- **FR-HUB-005 (M):** Health dashboard: service status, storage, sync queue, relay connectivity, backup status, version, pack versions.
- **FR-HUB-006 (M):** Refuse to go live until backup + restore drill verified (hard gate).
- **FR-HUB-007 (S):** One-click updater that verifies signatures and rolls back on failure (foundation for Y3–4 installer).

### 7.2 Calculation Engine (deterministic)

- **FR-CALC-001 (M):** Support assessment weights per subject/term (e.g., CA 40% + Exam 60%; configurable per pack).
- **FR-CALC-002 (M):** Compute totals, weighted averages, letter/numeric grades, GPA-style aggregates if pack defines them, class position/rank with tie-handling rule (e.g., dense rank vs. competition rank — pack-configurable, displayed on report).
- **FR-CALC-003 (M):** Rounding rule explicit and consistent (e.g., half-up to 1 decimal for averages; integer totals). Rule ID shown in audit + report footer.
- **FR-CALC-004 (M):** Recompute incrementally on data change; full-term recompute for a 1000-student school in <60s on reference hardware.
- **FR-CALC-005 (M):** Every computed value links to inputs + rule version ("Why this grade?" drill-down).
- **FR-CALC-006 (M):** Same inputs + same rule version always yield same outputs (property-tested).

### 7.3 Validation / Checking Engine

- **FR-VAL-001 (M):** Blocking checks: score > max or < 0, non-numeric, missing required entry, duplicate entry, weight sum ≠ 100%.
- **FR-VAL-002 (M):** Warning checks: sudden jump vs. student's own prior-term mean (configurable σ or absolute threshold, e.g., ±25 points triggers review), class-outlier review (e.g., >3 SD from class mean flagged for second look, never auto-changed).
- **FR-VAL-003 (M):** All flags require human disposition: Correct / Confirm-with-reason / Escalate. Auto-change is forbidden.
- **FR-VAL-004 (M):** Plain-language explanation per flag: rule ID, threshold, actual vs. expected, suggested next step.
- **FR-VAL-005 (S):** Pack-supplied common-error checklists (e.g., "transposed CA/Exam columns", "forgot to scale 30→40") runnable on demand.
- **FR-VAL-006 (S):** Configurable thresholds per school (with safe defaults); changes versioned + logged.

### 7.4 Comment Bank

- **FR-COM-001 (M):** Library organized by subject × performance band × trend (improving/stable/declining) × tone (encouraging/firm/formal).
- **FR-COM-002 (M):** Placeholder interpolation (`{name}`, `{subject}`, `{score}`, `{strength}`, `{next_step}`) with preview before save.
- **FR-COM-003 (M):** Teacher can use as-is, edit, or write custom; final text stored verbatim with source template ID for traceability.
- **FR-COM-004 (M):** Length guardrails per template (min/max chars) to fit report layout; overflow blocks report with clear message.
- **FR-COM-005 (S):** Local usage counters (which templates used/edited) to inform future pack improvements — never exfiltrated with PII.
- **FR-COM-006 (C):** Multi-language templates via packs (e.g., English, French, Yoruba/Hausa/Igbo where packs exist).

### 7.5 Report-Card Generation

- **FR-REP-001 (M):** Templates bound to verified data fields only; no free-typed grades on the report.
- **FR-REP-002 (M):** Integrity rule: if any report number ≠ source record at generation time, generation for that student aborts with reason. No partial/fabricated reports.
- **FR-REP-003 (M):** Outputs: paginated print-ready PDF (A4), per-student file naming `{ Year }_{ Term }_{ Class }_{ StudentID }.pdf`, batch print queue.
- **FR-REP-004 (M):** Each report carries: unique report ID, generation timestamp, rule-pack version, hash/signature, approval chain (teacher + head names/dates).
- **FR-REP-005 (M):** Approval workflow: Teacher review → Head approval → Lock. Locked reports immutable; corrections require new version + re-approval with version history.
- **FR-REP-006 (S):** Template preview with synthetic demo data (never real students) before live run.

### 7.6 Teacher Companion App

- **FR-APP-001 (M):** Android app (Android 9+ on 2GB RAM devices); iOS S. Works fully offline for entry/edit/comment draft.
- **FR-APP-002 (M):** LAN sync (auto-discover hub on school Wi-Fi) as preferred path; relay fallback when remote.
- **FR-APP-003 (M):** Entry sheets mirror hub max-scores/weights; instant local range checks; queued outbox with retry.
- **FR-APP-004 (M):** Flag inbox + comment picker/editor + approval actions with biometric/PIN confirm for approvals.
- **FR-APP-005 (M):** No PII stored unencrypted on device; encrypted store, remote wipe via hub-issued revoke on loss (MVP: revoke + re-key, full wipe S).
- **FR-APP-006 (S):** Low-data mode; relay payloads compressed before encryption; photo/scan of paper sheets C (post-MVP).

### 7.7 Relay ("Post Office") Service

- **FR-RLY-001 (M):** Opaque store-and-forward: `POST /envelopes`, `GET /envelopes?forHub=<id>`, `DELETE /envelopes/<id>`. Server never holds decryption keys.
- **FR-RLY-002 (M):** End-to-end encryption: X25519 + XSalsa20-Poly1305 (e.g., NaCl box) or equivalent; per-school hub keypair generated on-site, private key never leaves hub.
- **FR-RLY-003 (M):** TTL: auto-delete after 30 days unclaimed; delete shortly after confirmed delivery receipt (plus short grace for retries, e.g., 7 days).
- **FR-RLY-004 (M):** Minimal metadata only: opaque routing ID, size, timestamps, expiry. No student names/grades/subjects in plaintext headers.
- **FR-RLY-005 (M):** Rate limiting, abuse caps per school, and transparency log of aggregate throughput (no content inspection).
- **FR-RLY-006 (S):** Hub polling with backoff + manual "check now"; relay status visible in hub dashboard.

### 7.8 Backup, Restore & Disaster Recovery

- **FR-BKP-001 (M):** Encrypted backups (school-held keys; operator cannot decrypt cloud vault copies) to at least one of: USB drive, on-site second PC, operator vault.
- **FR-BKP-002 (M):** Automated schedule (default daily during term) + pre-report-run snapshot; integrity hash per backup.
- **FR-BKP-003 (M):** Pre-go-live restore drill mandatory; hub blocks live mode until drill passes and logs proof.
- **FR-BKP-004 (M):** One-click restore with dry-run verify (counts + hashes) before overwrite.
- **FR-BKP-005 (S):** Backup reminders + overdue escalation to Head/IT if >N days stale.

### 7.9 Identity, Keys & Access

- **FR-IDN-001 (M):** Hub keypair generated locally at install; public key registered with relay; private key exportable only as encrypted recovery phrase/paper key for Head.
- **FR-IDN-002 (M):** Teacher devices paired by QR/short code on LAN with Head/Admin approval; per-device keys revocable.
- **FR-IDN-003 (M):** All sensitive actions logged: who, what, when, before/after values (for scores), reason for overrides.

---

## 8. Data Model

Logical entities (physical schema to be finalized in tech design; all at rest encrypted on hub):

- **School** (`school_id`, name, address, year system, default locale, pack IDs + versions)
- **AcademicYear / Term** (`year_id`, `term_id`, name, start/end, status: draft/active/locked)
- **Student** (`student_id` school-scoped, names, class assignment history, status)
- **Staff / Teacher** (`staff_id`, role, assignments, device IDs, status)
- **Class / Subject / Assessment** (`class_id`, `subject_id`, `assessment_id`, max_score, weight, order)
- **Score** (`student_id`, `assessment_id`, `value`, `entered_by`, `entered_at`, `source`: manual/import/app, `version`)
- **ComputedResult** (`student_id`, `subject_id`, `term_id`, total, average, grade, position, rule_version, input_hash)
- **Flag** (`flag_id`, `score_id`/result ref, rule_id, severity: blocking/warning, status, disposition, actor, note)
- **Comment** (`comment_id`, `student_id`, `subject_id`, `term_id`, template_id or custom, final_text, author, approved_by)
- **Report** (`report_id`, `student_id`, `term_id`, template_version, rule_version, hash, signature, approvals, file ref, version chain)
- **AuditEvent** (append-only: actor, action, entity, before/after, timestamp, device)
- **Envelope** (relay only, opaque: `routing_id`, `ciphertext`, size, created/expiry) — no PII fields.

Constraints:

- Weights per subject/term MUST sum to 100% or term cannot lock.
- A `Report` MUST reference exact `ComputedResult` hashes; mismatch aborts.
- `Score` edits create new versions; never silent overwrite.
- Soft-delete only for students/scores; hard delete only via explicit GDPR-style erasure workflow with dual approval + log.

---

## 9. Business Rules Catalog

Deterministic, versioned, pack-overridable. Each rule has `RULE-ID`, inputs, formula/threshold, severity, explanation string.

### 9.1 Calculation rules

| Rule ID | Name | Default | Notes |
|---|---|---|---|
| CALC-WAVG-01 | Weighted average | `avg = Σ(score/max × weight)` | Weights from pack/school config |
| CALC-GRADE-01 | Grade mapping | Pack table (e.g., A ≥70, B 60–69…) | Pack defines bands; shown on report |
| CALC-RANK-01 | Class position | Competition rank ("1224"), ties share position | Alternative dense rank via pack option |
| CALC-ROUND-01 | Rounding | Totals integer; averages 1 decimal half-up | Must be stated in footer |
| CALC-ATT-01 | Attendance % | `present / (present+absent)` | Late handling per pack |

### 9.2 Validation rules

| Rule ID | Name | Severity | Default threshold |
|---|---|---|---|
| VAL-RANGE-01 | Out-of-range | Blocking | `value <0 or >max` |
| VAL-TYPE-01 | Non-numeric/empty required | Blocking | — |
| VAL-MISS-01 | Missing entry | Blocking | Any required assessment empty at lock time |
| VAL-DUP-01 | Duplicate submission | Blocking | Same student+assessment submitted twice with different values |
| VAL-WEIGHT-01 | Weights ≠100% | Blocking | Sum check at setup + lock |
| VAL-JUMP-01 | Sudden jump vs. self | Warning | Δ ≥25 pts vs. prior-term subject mean → review |
| VAL-OUTLIER-01 | Class outlier | Warning (review only) | >3 SD from class mean → second look, never auto-change |
| VAL-COLSWAP-01 | Suspected CA/Exam swap | Warning | Heuristic checklist from pack (e.g., whole class CA≪Exam inversion) |
| VAL-COMLEN-01 | Comment overflow | Blocking | Exceeds template box |

All thresholds tunable per school with versioned change log. Pilot defaults conservative (prefer false-positive review over silent error).

### 9.3 Report integrity rules

- REP-INT-01: Report generation reads from locked term snapshot; any concurrent edit invalidates draft and forces regenerate.
- REP-INT-02: Number mismatch (report field ≠ source hash) → abort that student's report, log, notify admin.
- REP-INT-03: Missing approval → no lock/signature; watermark "DRAFT — NOT OFFICIAL" on unapproved previews.

---

## 10. Non-Functional Requirements

| Category | Requirement (MVP target) |
|---|---|
| **Performance** | Full-term recompute ≤60s for 1000 students × 10 subjects on reference office PC (i3/4GB). Report PDF batch ≤5s/student. App entry keystroke latency <100ms offline. |
| **Scalability** | Single-hub MVP: up to ~2000 students, ~100 staff, 5 years history on 128GB disk. Multi-hub / sharding deferred. |
| **Availability / Offline** | Hub + app fully usable with zero internet. Relay is fallback only. No feature requires cloud to compute or print. |
| **Reliability** | No silent data loss: write-ahead + checksums; crash recovery on restart; backup integrity check on every run. |
| **Durability** | Dual-copy rule: live DB + at least one verified backup before term lock. |
| **Security** | Encrypted at rest (hub DB + app store), E2E for relay, signed updates/packs/reports. External review before pilot PII. |
| **Privacy** | Relay and operator cannot decrypt PII by construction. Anonymous stats only above k-anonymity threshold (see §12). |
| **Usability** | Setup completable by non-engineer with guide; entry doable one-handed on low-end phone; plain-language errors, no jargon. |
| **Accessibility** | Large-text mode, high-contrast report templates, keyboard-navigable hub console (WCAG 2.2 AA best-effort for console). |
| **Maintainability** | Deterministic engine with property tests; rule versions pinned per term; reproducible builds; plain-language runbooks. |
| **Portability** | Hub Windows-first; data export (encrypted + documented CSV) to avoid lock-in. |
| **Compliance** | Support NDPR (Nigeria), GDPR-style erasure/audit, and local education record rules via packs; parental-consent capture where required. |

---

## 11. Architecture & Proposed Tech Stack

> This section proposes a boring, low-cost stack. Final choice to be confirmed in tech design, but any substitute MUST preserve local-first + zero-knowledge properties.

```
[Teacher Phones] --LAN (mDNS/TLS)--> [School Hub PC] --poll--> [Relay (opaque)] <--push-- [Teacher Phones remote]
     (encrypted store)                (encrypted DB, calc/validation/report engines, admin console)
                                           | encrypted backup
                                           v
                                  [USB / 2nd PC / Cloud Vault (opaque blobs)]
```

- **Hub app:** Tauri/Electron + embedded service OR single-binary Go/Rust backend + local web UI (preferred for reliability + auto-start on boot). Embedded SQLite (SQLCipher) for data.
- **Calc/validation engine:** Pure, dependency-free module with versioned rules (JSON/YAML packs + engine semver), 100% unit + property-tested.
- **Reports:** HTML→PDF pipeline (headless Chromium or WeasyPrint equivalent) with signed output (Ed25519 hub key).
- **App:** Flutter or native-lite (Kotlin/Swift) with SQLCipher store; LAN discovery + TLS with pinned hub cert; background outbox sync.
- **Relay:** Stateless-ish Go/Rust API + object store (S3-compatible) with TTL sweeper; no DB of PII; horizontal, cheap, auditable. Clients E2E-encrypt before upload.
- **Packs:** Signed ZIPs (JSON schemas + HTML templates + comment CSVs + checklists) with semver + channel (stable/beta).
- **Updates:** Signed OTA with rollback; hub polls relay/CDN for manifests (manifests contain no PII).

**Reference hardware (MVP):** Any office desktop: dual-core+, 4GB RAM, 128GB free, USB port, Wi-Fi/LAN. No GPU, no server OS.

---

## 12. Security & Privacy Requirements

- **SEC-001 (M):** External security review (app + hub + relay + crypto usage) completed and remediated **before** any real student data is loaded in pilot.
- **SEC-002 (M):** Threat model published internally: stolen hub, stolen phone, malicious relay operator, network attacker, insider teacher — with mitigations per threat.
- **SEC-003 (M):** E2E encryption for all relay payloads; relay logs contain no PII/plaintext scores; TLS in transit + E2E at message layer.
- **SEC-004 (M):** At-rest encryption: SQLCipher (hub + app) with OS-keystore-held keys + school recovery phrase.
- **SEC-005 (M):** Signed artifacts: hub binaries, app releases, packs, reports. Unsigned code/data refused.
- **SEC-006 (M):** Append-only audit log, tamper-evident (hash-chained), exportable for inspectors without exposing unrelated PII.
- **PRI-001 (M):** Anonymous aggregate statistics (Years 3+) only when **k ≥ N schools AND n ≥ M students per bucket** (e.g., N=20 schools minimum; exact N/M set with auditor). Below threshold: no collection, manual pack improvement only.
- **PRI-002 (M):** Aggregates limited to non-identifying counts (e.g., "X% of schools hit VAL-COLSWAP-01 this term", "template Y used Z times") — never names, scores, or small-cell breakdowns.
- **PRI-003 (M):** Differential-privacy/noise or bucketing review before any Y5–6 federated pattern feature ships.
- **PRI-004 (M):** Plain-language privacy notice for parents: what stays at school, what the relay holds (sealed envelopes, 30-day delete), how to request correction/erasure.
- **OPS-001 (M):** Operator runbooks for key loss (recovery phrase), hub theft (revoke + restore to new PC), relay abuse — all exercisable without reading PII.

---

## 13. UX / UI Requirements

- **UX-001:** Hub console: left nav (Dashboard, Students, Scores, Flags, Comments, Reports, Packs, Backup, Settings), global term switcher, readiness checklist with blocking vs. warning states.
- **UX-002:** Every number shows provenance on hover/click: inputs + rule ID + version ("Why?" link).
- **UX-003:** Flag inbox triage: filter by severity/class/subject, bulk assign, one-tap Correct/Confirm, reason required for Confirm.
- **UX-004:** Comment picker: 3-tap flow (band → trend → tone → sentence), live preview with name filled, edit inline, char-count guard.
- **UX-005:** Report preview with DRAFT watermark until locked; side-by-side source-vs-report check for admins.
- **UX-006:** Empty/error states in plain language (no jargon): e.g., "3 scores are missing for JSS2-A Maths. Add them before reports can be printed."
- **UX-007:** Print-first report layouts: A4, ink-friendly, dyslexia-considerate font option, local language packs.
- **UX-008:** Onboarding: 15-minute guided setup + demo school dataset (synthetic) + printed quick-start for staff room wall.

---

## 14. Rule & Template Packs (Marketplace)

Packs let one engine serve many curricula without forking code.

- **PACK-001:** Pack = `{ grading_scales.json, weights.json, report_templates/*.html, comments/*.csv, checks/*.yaml, locale.json, CHANGELOG }` + signature + semver.
- **PACK-002:** MVP ships 2–3 packs (e.g., Nigeria Lower/Upper Basic + Secondary generic; British/American S). Country/exam-board packs (WAEC/NECO/JAMB-adjacent scales where applicable) as paid add-ons Y3+.
- **PACK-003:** Pack install is atomic + reversible; term pins pack version; mid-term pack upgrade blocked unless admin overrides with re-validation.
- **PACK-004:** Pack telemetry (anonymous, threshold-gated): install counts, template usage ranks, check hit-rates — used to prioritize pack fixes. No PII.
- **PACK-005 (Y9–10):** Third-party pack SDK + review process; revenue share for certified publishers.

---

## 15. Monetization & Business Model

WhatsApp analogy holds: private data stays private; business charges at the edges.

| Stream | Pricing sketch (to validate) | Notes |
|---|---|---|
| School subscription | Annual per-school (tiered by size, e.g., <200 / 200–800 / 800+ students) | Covers software, updates, support. Pilot free/discounted for 10–30 schools. |
| Rule & template packs | One-time or annual per pack | Country/exam/subject packs; site license option for districts. |
| Setup & hardware help | Fixed-fee install + optional hardware bundle referral | For schools lacking PC/network; phone-company-WiFi-setup analogy. |
| Encrypted backup vault | Small monthly per GB (opaque blobs) | Operator cannot read contents; retention + restore SLA. |

Guardrails: no sale of PII, no ads against student data, no pay-per-report extraction. Pricing published plainly for trust.

---

## 16. Ten-Year Phased Rollout

### Years 1–2: Prove It Actually Works (Pilot)
- Build hub incrementally with independent verification per milestone (calc → validation → comments → reports → sync → backup).
- External security review + backup-restore drill (deliberate break-and-restore) before PII.
- Recruit 10–30 diverse pilot schools (urban/rural, big/small, good/poor connectivity).
- Mandatory human approval on every report in first grading period.
- Instrument (locally): time-to-report, flag precision/recall (via teacher dispositions), comment-bank usefulness, parent satisfaction (survey, no PII to cloud).
- Exit criteria: median report cycle 3 days → <1 hr; zero unencrypted PII leaves site; restore drill 100% pass; pilot renewal intent.

### Years 3–4: Make It Easy to Install Anywhere
- One-click installer + self-test; non-engineer install verified by trial with naive installer.
- Commodity-hardware certification (no special purchases).
- Paid subscriptions live; support tiers + SLAs.
- Relay begins threshold-gated anonymous counts (e.g., "30% hit same entry mistake") to seed checklist packs.
- Exit: install success >90% unassisted; support tickets/school declining; NRR positive.

### Years 5–6: Schools Help Each Other (Private Collective Improvement)
- Enable aggregate pattern loop ONLY above anonymity thresholds; otherwise keep manual.
- Ship improved checks + comment packs derived from blurred counts; no school identifiable.
- Expand to universities, training centers, tutoring programs (weights/GPA packs, transcript templates).
- Exit: measurable flag-precision lift from shared checklists without any PII sharing incident.

### Years 7–8: Become the Gold Standard
- Publish plain-language architecture + rule specs + privacy proofs; invite journalists/inspectors to reproduce.
- Independent audits (security + privacy); public remediation log.
- Regulator endorsements / exemplar status in at least one jurisdiction.
- Exit: audit pass, published reports, inbound government pilots.

### Years 9–10: Ecosystem
- Pack marketplace + SDK; country/subject packs from third parties.
- License privacy-first pattern to adjacent domains (clinics, law firms, local gov) — separate products, same sealed-relay + local-hub blueprint.
- Agent Mark becomes reference blueprint, not just a product.

---

## 17. Success Metrics & KPIs

| Metric | Pilot target (Y1–2) | Later target |
|---|---|---|
| Report cycle time (data-complete → signed batch) | <1 hr median (from ~3 days) | <30 min |
| Calculation correctness (independent re-check sample) | 100% match | 100% match |
| Blocking-flag precision (confirmed errors / total blocking flags) | >90% | >95% |
| Reports blocked by integrity mismatch that were true mismatches | 100% caught, 0 false prints | Same |
| Backup restore drill pass rate | 100% before go-live | 100% termly sample |
| Unencrypted PII egress incidents | 0 | 0 |
| Teacher approval time per class | <15 min | <10 min |
| Comment-bank reuse (used as-is or lightly edited) | >60% | >75% |
| Pilot renewal / paid conversion | ≥70% of pilots convert | NRR >110% |
| Install success unassisted (Y3+) | — | >90% |
| Support median first response | <24h pilot | <4h paid |

All cloud-side metrics are aggregate-only and threshold-gated; per-student analytics are forbidden.

---

## 18. Risks, Trade-Offs & Mitigations

| # | Risk / Trade-off (honest) | Mitigation in PRD |
|---|---|---|
| T1 | Single PC = single point of failure (theft/fire/failure) | Mandatory dual copy + proven restore before go-live (FR-BKP-001–004); theft runbook with revoke + re-key; optional 2nd on-site PC |
| T2 | More setup than cloud signup | 15-min wizard + one-click installer (Y3–4) + paid setup service; demo data; wall-chart quick-start |
| T3 | Must win on trust/reliability, not flash | Ruthless basics: correctness, clear checks, good templates, fast support; public proofs over marketing |
| T4 | Comments chosen, not invented (less "magic") | Position as control + appropriateness win; invest in bank quality via anonymous usage ranks |
| R1 | Key loss locks school out | Recovery phrase + dual-custody (Head + Admin); tested restore drill covers re-key |
| R2 | Relay abuse / downtime | TTL + caps + minimal relay; LAN-first so outage only affects remote entry, never local compute/print |
| R3 | Threshold gaming / small-cell leak in aggregates | Hard k-threshold gate + auditor-set N/M + manual fallback; no small breakdowns |
| R4 | Scope creep into LMS/fees/AI | Explicit non-goals; pack system absorbs variation without core fork |
| R5 | Low-end device / power / connectivity | Offline-first, low-RAM targets, compressed payloads, print-first outputs |

---

## 19. Open Questions & Decisions Needed

1. Reference OS floor: Windows 10 only for pilot, or include Ubuntu LTS from day one?
2. Exact anonymity thresholds (N schools, M students) — set with auditor before Y3 telemetry?
3. Rank/tie and rounding defaults per flagship pack — confirm with pilot exam officers?
4. Relay TTL grace after delivery (propose 7 days) and retention for undeliverable abuse holds?
5. Report signature format: hub Ed25519 detached + QR verification vs. printed code?
6. Roster ID scheme: school-assigned vs. system UUID + human short-code?
7. Pricing tiers and pilot discount terms — validate with 5 heads before build?
8. Language priority for comment packs beyond English?
9. Parent distribution in MVP: print-only vs. admin-managed encrypted PDF handoff?
10. Auditor selection and review scope/timeline for pre-PII gate?

---

## 20. Acceptance Criteria & Definition of Done

### Pilot-ready (Y1–2 exit) MUST all hold:

- [ ] Hub installs on reference office PC; setup wizard completes with demo data in ≤15 min.
- [ ] Calculation property tests pass (10k randomized cases; determinism + rounding + ranking).
- [ ] Validation rules fire correctly on seeded error suite (range/missing/dup/jump/outlier/swap) with plain-language explanations.
- [ ] Comment flow: pick → fill → edit → save in ≤3 taps + edit; overflow correctly blocks.
- [ ] Report integrity: mutated-source test always aborts mismatched report; DRAFT watermark enforced; lock + version chain works.
- [ ] Offline entry + LAN sync + relay fallback demonstrated with airplane-mode and home-network tests.
- [ ] Relay stores only ciphertext; operator decryption attempt fails; 30-day TTL auto-delete verified.
- [ ] Backup → wipe → restore drill passes with hash-equal verification on all pilots.
- [ ] External security review findings remediated; report filed.
- [ ] First-term reports 100% human-approved; median cycle <1 hr; zero PII egress; teacher/parent satisfaction surveyed.

### Engineering DoD (per milestone):

- Deterministic engine covered by unit + property tests; rule versions pinned.
- Signed builds/packs; rollback tested.
- Audit log hash-chained and exportable.
- Runbooks (install, backup/restore, theft, key loss, relay outage) tested by non-author.

---

## 21. Appendices

### A. Glossary (plain English)

- **Hub:** The school's own PC that holds records and does the math.
- **Relay / Post office:** Tiny cloud holder of sealed envelopes; cannot open them; deletes after ~30 days.
- **Envelope:** An encrypted message only the hub (or paired phone) can open.
- **Pack:** Downloadable rules/templates/comments for a country/exam/subject.
- **Flag:** A "hey, check this" note from a rule; blocking stops reports, warning asks for review.
- **Lock:** Freezing a term's numbers so reports are stable and traceable.

### B. Report footer (required print line)

> `Report {report_id} · {school} · {term} · Rules {rule_version} · Pack {pack_id vX.Y} · Generated {ts} · Hash {short} · Approved {teacher}, {head}`

### C. Explicit non-AI statement

This PRD describes a system with **no machine-learning or generative-AI components**. All behavior is rule-based and reproducible. Any future AI assistance (e.g., drafting comment suggestions) would require a separate PRD, privacy review, and opt-in — and MUST NOT weaken the zero-knowledge relay guarantee.

### D. Source traceability

Every section above traces to the ten-year plan: local-first hub (§1), deterministic rules + comment bank + mismatch refusal (§1), sealed relay with 30-day delete (§1), WhatsApp-style monetization (§2), 10–30 pilots + review + drill + approval + 3-days-to-1-hour (§3 Y1–2), one-click install + commodity PC + paid subs + anonymous counts (§3 Y3–4), threshold-gated sharing + more institution types (§3 Y5–6), plain-language publishing + audits + regulator exemplar (§3 Y7–8), packs + licensing to health/legal/gov (§3 Y9–10), single-PC backup mandate + trust over flash + chosen-not-invented comments (§4).

---

*End of PRD v1.0 — ready for review. Next step: resolve §19 decisions, then cut tech design + pilot recruitment list.*
