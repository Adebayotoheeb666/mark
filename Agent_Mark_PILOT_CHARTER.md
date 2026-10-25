# Agent Mark — Pilot Charter (10–30 Schools, Years 1–2)
**Status:** Draft v1.0 | **Implements:** Impl Plan Phase 9 + PRD §16 Y1–2, §17 KPIs, §20 acceptance

## 1. Purpose & Success Contract
Prove in real schools: report cycle **~3 days → <1 hr median**, 100% calc correctness on audit sample, **zero unencrypted PII leaves site**, teachers approve, parents trust.

## 2. School Selection (diverse by design)
- Target 10–30: mix urban/rural, small (<200) / mid (200–800) / large (800+), good/poor connectivity, at least 3 low-resource (no IT staff).
- Inclusion: office PC Win10+ 4GB+, head + exams officer committed, ≥1 term of paper/Excel baseline timing available.
- Exclusion: schools demanding cloud portal or AI comments in MVP; schools unable to designate key custodians.
- Commercials: free Year 1, 50% Year 2 if drills + surveys completed; conversion to paid tiers (<200/200–800/800+) after.

## 3. Roles (RACI summary)
| Activity | Head | Admin/Exams | Teachers | IT/Power user | Agent Mark team |
|---|---|---|---|---|---|
| Setup + roster import | A | R | C | R (install) | S |
| Key custody (phrase) | R | R (2nd copy) | — | — | guide |
| Score entry | — | — | R | — | S |
| Flag triage | A | S | R | — | S |
| Comment + approval (first term 100%) | A (batch) | S | R (class) | — | S |
| Backup + drill | A | R | — | R | verify |
| Surveys | R | R | R | — | collect (no PII) |

## 4. Timeline per School (one term, ~10–12 weeks)
Wk 1: install → wizard → roster dry-run → keys + custody receipts.
Wk 2: **restore drill (blocking)** → Go-Live signed → teacher pairing + 1-hr training.
Wk 3–8: live entry + weekly flag review + support check-ins; baseline timing captured.
Wk 9–10: draft → 100% teacher review → head lock → print/distribute (manual).
Wk 11: audit sample re-check + surveys + pilot report + renew/convert decision.

## 5. Rules of Engagement
- First grading period: **every report human-approved**; automation assists only.
- No real data before drill + security-review remediation (hard gate).
- Support: <24h first response pilot; severity P1 (cannot print in report week) → same-day remote/on-site.
- Data: school owns all PII; export (encrypted + CSV) free anytime; offboarding wipes vault blobs on request (certified).

## 6. Metrics (local-only collection, no PII to cloud)
Cycle time, correctness sample %, blocking precision, comment reuse %, drill pass, egress incidents (must be 0), approval min/class, teacher NPS, parent readability score, support tickets/school.

## 7. Exit & Go/No-Go to Y3–4
Go if: median <1 hr, 100% sample match, 0 egress, 100% drill, ≥70% renew intent, top-3 frictions have fixes scoped. Else second term, no scaling.

## 8. Risks & Mitigations
Power/internet → offline-first + USB installers. Staff turnover → retrain + re-pair in <1 day. Exam-week pressure → freeze updates, daily backups, P1 hotline. Key loss → split custody + drill.

## 9. Sign-Off
Head __________ Admin __________ Agent Mark __________ Date ______
*Attach: custody receipts, drill certificate, survey blanks.*
