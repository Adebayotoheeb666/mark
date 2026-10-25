# Phase 0 Report — Foundations & Tech Design
**Date:** 2026-10-16 | **Strategy:** Plan → Build → Test → Document → Repeat | **Result:** GATE PASSED → proceed to Phase 1

## Plan (done)
Locked 10 ADRs (DECISIONS.md), reference HW Win10+/i3/4GB/128GB, monorepo layout, CI smoke, threat model v0, schemas + synthetic demo, pack v0 + sign/verify.

## Build (done)
Scaffold: `README.md`, `hub|engine|app|relay|packs/README.md`, `schemas/{pack_manifest,score_batch}.json`, `packs/{manifest,grading_scales,weights}.example.* + checks.example.yaml`, `demo/{demo_school.json,seeded_errors.csv,expected_flags.json,boundary_vectors.json}`, `scripts/{validate_demo,pack_sign_verify}.py`, `.github/workflows/ci.yml`.

## Test (done — executed 2026-10-16)
- `python scripts/validate_demo.py` → ALL OK (8 JSON valid, 6 CSV rows/3 flagged, weights sum 100/100).
- `python scripts/pack_sign_verify.py` → OK (hmac-fallback; sha256 380bd13c…; manifest content OK). Note: runner lacks PyNaCl → ed25519 path untested; CI image must include PyNaCl before Phase 4 pack signing.
- Reproducibility: files deterministic, no timestamps/hashes embedded. Independent check: reviewer re-runs same two commands.

## Document (done)
TECH_DESIGN, DECISIONS (10 ADRs), DATA_MODEL_RULES_SPEC, THREAT_MODEL_PRIVACY v0, TEST_STRATEGY already in repo; this report closes the loop.

## Repeat / Gate G0→G1
- [x] §19 decisions recorded (10/10, 2 proposed for auditor/head validation: pricing ADR-006, thresholds ADR-010)
- [x] CI smoke green locally (GitHub run pending push)
- [x] Schemas + demo + pack round-trip pass
- [ ] Carry-forward to Phase 1: 60-student full fixture, engine property harness, PyNaCl in CI, Linux build advisory.

**Next:** Phase 1 — Calculation Engine (pure module + 10k property cases + independent Excel/Python 100-case match).
