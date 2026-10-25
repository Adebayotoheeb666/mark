# Agent Mark — Hub Admin Guide (reference build)
**15-min setup:** Install → Wizard (school→year/term→subjects→pack→roster CSV dry-run→assignments) → Backup+Drill (blocking) → Pair teacher phones → Go Live.

## Readiness checklist
Blocking (must be zero): students imported, assessments configured, weights sum 100/subject, `backup_verified=yes`, `drill_passed=yes`. Warning: no scores yet.
`readiness()` reports both; `go_live()` refuses with reasons until ready.

## Daily ops
Health: storage, queue, relay, backup age, versions. Scores versioned (update = new row, old kept). Reports: draft→review→lock; concurrent edit invalidates draft. Overdue backup >3d banners, >7d blocks term lock.

## RBAC
| action | admin | head | teacher | viewer |
|---|---|---|---|---|
| setup/import/users | ✓ | view | – | – |
| scores.enter | ✓ | – | ✓ (own classes) | – |
| flags/comments/draft | ✓ | ✓ | ✓ | – |
| reports.lock/backup | ✓ | ✓ | – | – |
Teacher scoping by assignment enforced by caller; all denials logged.

## Audit
Append-only hash-chained (`audit_verify()`). Every score add/update + flag + backup/drill + lock records actor/before/after. Export redacted bundle for inspectors (no bulk PII).
**Prod delta:** SQLCipher at rest, OS-keystore keys, auto-lock, TLS+pinning (see TECH_DESIGN) — this Python ref proves logic on plain SQLite.
