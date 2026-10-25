# Agent Mark — Validation Rules (VAL)
**Status:** Phase 2 built | **Defaults:** conservative (prefer review over silence)

| ID | Severity | Default | Meaning |
|---|---|---|---|
| VAL-RANGE-01 | blocking | v<0 or v>max | Out-of-range score |
| VAL-TYPE-01 | blocking | non-numeric | Re-type digits only |
| VAL-MISS-01 | blocking | required empty | Fill or mark absent w/ note |
| VAL-DUP-01 | blocking | differing dupes | Confirm correct entry (logged supersede) |
| VAL-WEIGHT-01 | blocking | sum≠100 | Fix weights before lock |
| VAL-JUMP-01 | warning | Δ≥25 vs prior mean | Confirm or correct |
| VAL-OUTLIER-01 | warning | >3 SD, ≥4 peers | Second look, never auto-changed |
| VAL-COLSWAP-01 | warning | class CA med<35 & Exam med>65, ≥70% inverted, ≥5 rows | Check swapped columns |
| VAL-COMLEN-01 | blocking | len>box | Shorten comment |

## Lifecycle
`open → corrected | confirmed-with-reason | escalated → resolved`. Confirm requires note. All logged (`flag.raise`, `flag.<disposition>`).

## Tuning
Per-school `Thresholds(jump_pts, outlier_sd, version)`; changes versioned + logged. Pilot stays on `default-v1` unless head approves override.

## Admin runbook (triage)
1. Filter blocking first → subject → assignee. 2. Correct (re-enter), Confirm (reason required), Escalate (head). 3. Re-run checks before report draft. Precision metric: confirmed-errors / blocking flags (target >90%).
