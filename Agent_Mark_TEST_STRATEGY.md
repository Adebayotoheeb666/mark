# Agent Mark — Test Strategy
**Status:** Draft v1.0 | **Applies to:** every phase loop (Test step) | **Gates:** §20 PRD acceptance

## 1. Levels
1. **Unit** (engine/rules): every CALC/VAL rule, boundary + fuzz. Required coverage: 100% of rule branches.
2. **Property** (engine): determinism, monotonicity, tie-correctness, rounding; 10k randomized/CI.
3. **Integration:** hub DB + engine + packs + PDF; app LAN + outbox; hub↔relay sealed round-trip.
4. **E2E:** fresh install → wizard → import → entry → flags → comments → approvals → print → backup→wipe→restore on reference PC + low-end Android.
5. **Chaos/Adversarial:** power-kill mid-write, relay down week, duplicate/replay envelopes, mutated-source report, bad-sig pack/update, disk-full, clock-skew.
6. **Usability:** naive installer (non-engineer), teacher entry trial, flag-triage timing, parent readability check.
7. **Security/Privacy:** opacity (decrypt-fail), log-grep zero-PII, TTL delete, revoke, audit-chain tamper.

## 2. Seeded Fixtures (all in repo, synthetic only)
- `demo_school.json` (60 students, 3 classes, 5 subjects) + `seeded_errors.csv` (each VAL rule ≥2 positives) + `expected_flags.json`.
- `boundary_vectors.json`: 0, max, max+1, -1, empty, " 85 ", 85.5, dup same/different, weight 99/100/101, tie ranks, 69.45/69.5 grade edges.

## 3. Entry / Exit Criteria
- **Definition of Ready (phase starts):** spec + ADRs + fixtures + acceptance thresholds written; independent checker assigned.
- **Definition of Done (phase ends):** all tests above pass for scope; docs/runbooks updated; demo + retro held; gate checklist signed; PRD traceability updated.

## 4. Pilot Acceptance (maps to PRD §20)
- Median report cycle <1 hr; correctness sample 100%; blocking precision >90%; comment reuse >60%; drill 100%; 0 egress; first-term 100% human approval.
- Field chaos (power cut, theft-sim, relay outage) recovered via runbooks.

## 5. CI Enforcement
- Fail merge on: golden-vector mismatch, property failure, PII-grep hit in relay paths, unsigned artifact, coverage drop on `engine/*`.
- Nightly: full property (100k cases) + restore drill on VM + relay TTL accelerated-clock test.

## 6. Roles
- Builder implements; independent checker (pair-swap; external for Phases 8/11/12) must reproduce key results. No self-sign-off on gates.
*End — add per-phase test reports under `/e2e/reports/<phase>/`.*
