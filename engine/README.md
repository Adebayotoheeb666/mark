# Engine (Phase 1–2)
Pure calc + validation, zero deps. **Phase 0: contract only — implementation in Phase 1.**

Contract: `engine/calc` (WeightedAvg, MapGrade, Rank, Round) + `engine/validate` (VAL-* flags).
Golden vectors live in `../demo/*.json`; property tests 10k cases in CI (Phase 1).
See `../Agent_Mark_DATA_MODEL_RULES_SPEC.md` §4.
