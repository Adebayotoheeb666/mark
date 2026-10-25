# Phase 1 Report — Calculation Engine
**Date:** 2026-10-16 | **Strategy:** Plan → Build → Test → Document → Repeat | **Result:** GATE PASSED → proceed to Phase 2

## Plan (done)
Spec: weights→totals→avg(tenths, half-up)→grades(pack bands)→ranks(competition default, dense optional); rule version `engine 0.3.0 + pack`; VAL-WEIGHT-01 on sum≠100.

## Build (done)
- `engine/calc.py` — Fraction-exact `weighted_avg_tenths`, `map_grade`, `rank_positions`, `attendance_tenths`, `compute_subject` (+hash/provenance), `explain()`
- `engine/pack_loader.py` — scale/weights load + validation + `subject_items`
- `engine/testdata/vectors.json` (6 vectors, 3 rank cases), `engine/ENGINE_SPEC.md`

## Test (done — executed)
- `pytest engine/tests/test_calc.py` → **6/6 passed** (golden, boundaries, ranks, blocking errors, property 10k, perf)
- Perf: 1000 students × 10 assessments in ~0.4s (< 60s budget)
- `python scripts/independent_check.py` → **100/100 match** (naive float re-implementation: total+grade exact, avg ±0.05) → `engine/testdata/independent_check.csv`

## Document (done)
`engine/ENGINE_SPEC.md` + provenance strings for UX-002.

## Repeat / Gate G1→G2
- [x] Vectors + property + perf pass; [x] independent 100% match; [x] no I/O/network in engine (pure module)
- Carry-forward: 60-student full fixture + attendance vectors in Phase 2; Go/Rust port keeps this Python as golden reference.
