# Agent Mark — Engine Spec (CALC)
**Status:** Phase 1 built | **Engine:** 0.3.0 | **Rules:** CALC-WAVG-01, GRADE-01, RANK-01, ROUND-01, ATT-01

## Formulas
- `avg = Σ(value/max × weight)`, weights sum exactly 100 (else VAL-WEIGHT-01). Averages stored as **tenths** (int), half-up.
- Grades via pack band table (default A≥70 B60–69 C50–59 D45–49 E40–44 F<40).
- Rank default **competition "1224"** (dense optional per pack).
- Totals integer sums; attendance `present/total` in tenths.

## Determinism
Same inputs + same `engine+pack` version → same outputs + `input_hash`. `explain(result)` gives the "Why this grade?" string for UX-002.

## Pack integration
`pack_loader` enforces weight sums, builds `[(value,max,weight)]` from entered values, raises VAL-MISS-01 on gaps.
