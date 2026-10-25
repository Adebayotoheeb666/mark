# Agent Mark — Data Model & Rules Spec
**Status:** Draft v1.0 | **Implements:** PRD §8, §9 | **Needed for:** Phases 1–5

## 1. Conventions
- IDs: UUIDv4 internally; human short-codes where specified (ADR-005).
- Time: UTC ISO-8601 at rest; displayed in school locale.
- Money/scores: integers where possible; averages stored as tenths (e.g., 685 = 68.5) to avoid float drift.
- Soft-delete: `status: active|archived`, `deleted_at` nullable. Hard erase only via dual-approval workflow.
- Every mutating write logs to `audit_events` (hash-chained).

## 2. Entities (logical → SQLite tables)

### School / Year / Term
```json
{"school_id":"uuid","name":"Example Academy","address":"...","locale":"en-NG","pack_ids":["ng-basic@1.2.0"]}
{"year_id":"uuid","school_id":"uuid","label":"2026/2027","status":"active"}
{"term_id":"uuid","year_id":"uuid","name":"First Term","start":"2026-09-08","end":"2026-12-12","status":"draft|active|locked","pack_pin":"ng-secondary@1.4.0","rule_version":"engine 0.3.0 + ng-secondary 1.4.0"}
```

### Student / Staff
```json
{"student_id":"uuid","short_code":"26-JSS2A-014","first_name":"...","last_name":"...","class_id":"uuid","status":"active"}
{"staff_id":"uuid","name":"...","role":"admin|head|teacher|viewer","assignments":[{"class_id":"...","subject_id":"..."}]}
```

### Class / Subject / Assessment
```json
{"class_id":"uuid","label":"JSS2-A","level":"JSS2"}
{"subject_id":"uuid","label":"Mathematics"}
{"assessment_id":"uuid","subject_id":"uuid","term_id":"uuid","label":"CA1","max_score":20,"weight_pct":20,"order":1}
```
Constraint: `SUM(weight_pct) = 100` per (subject, term) or term cannot lock (VAL-WEIGHT-01).

### Score (versioned, never silent overwrite)
```json
{"score_id":"uuid","student_id":"uuid","assessment_id":"uuid","value":17,"entered_by":"staff_id","entered_at":"ts","source":"app|hub|csv","version":2,"supersedes":"uuid|null"}
```

### ComputedResult
```json
{"result_id":"uuid","student_id":"uuid","subject_id":"uuid","term_id":"uuid","total":82,"avg_tenths":685,"grade":"B","position":4,"rule_version":"...","input_hash":"sha256:..."}
```

### Flag
```json
{"flag_id":"uuid","ref":"score_id|result_id","rule_id":"VAL-RANGE-01","severity":"blocking|warning","status":"open|resolved","disposition":"corrected|confirmed|escalated|null","actor":"staff_id","note":"...","created_at":"ts"}
```

### Comment
```json
{"comment_id":"uuid","student_id":"uuid","subject_id":"uuid","term_id":"uuid","template_id":"math-B-stable-enc-07|null","final_text":"...","author":"staff_id","approved_by":"staff_id|null"}
```

### Report
```json
{"report_id":"uuid","student_id":"uuid","term_id":"uuid","template_ver":"ng-secondary-rep@1.4.0","rule_version":"...","hash":"sha256:...","sig":"ed25519:...","approvals":[{"by":"...","at":"ts","role":"teacher|head"}],"version":1,"file":"26_1T_JSS2A_014.pdf"}
```

### AuditEvent (append-only)
```json
{"seq":1234,"ts":"...","actor":"staff_id|system","action":"score.update","entity":"score_id","before":{},"after":{},"prev_hash":"...","hash":"..."}
```

### Envelope (relay only, opaque)
```json
{"id":"uuid","for_hub":"hub_pubkey_fp","size":1840,"created_at":"ts","expires_at":"ts","ciphertext_b64":"..."}
```

## 3. CSV Import Contract (roster + scores)
- Roster columns: `short_code,first_name,last_name,class_label,gender?,status`. Dry-run returns `{row, errors[]}`; blocking errors: dup short_code, unknown class, empty name.
- Scores columns: `student_short_code,assessment_label,value`. Range-checked against `max_score` on import.

## 4. Rules Catalog (normative)

### 4.1 CALC
| ID | Formula | Default |
|---|---|---|
| CALC-WAVG-01 | `avg = Σ(value/max × weight)` | weights from pack |
| CALC-GRADE-01 | band lookup in `grading_scales.json` | e.g., A≥70 B60–69 C50–59 D45–49 E40–44 F<40 (pack may differ) |
| CALC-RANK-01 | competition rank, ties share | dense optional via pack flag |
| CALC-ROUND-01 | totals int; avg tenths half-up | footer prints rule |
| CALC-ATT-01 | `present/(present+absent)` | late per pack |

### 4.2 VAL (severity + message template)
| ID | Severity | Trigger | Message |
|---|---|---|---|
| VAL-RANGE-01 | blocking | v<0 or v>max | "17 exceeds max 20 for CA1 — check entry." |
| VAL-TYPE-01 | blocking | non-numeric/empty required | "Score missing or not a number." |
| VAL-MISS-01 | blocking | required empty at lock | "3 scores missing for JSS2-A Maths." |
| VAL-DUP-01 | blocking | same student+assessment, differing values | "Duplicate entry with different values — confirm correct one." |
| VAL-WEIGHT-01 | blocking | weights ≠100 | "Weights sum to 95%, must be 100%." |
| VAL-JUMP-01 | warning | \|Δ\|≥25 vs prior-term mean | "Jump from 52 to 84 avg — confirm or correct." |
| VAL-OUTLIER-01 | warning | >3 SD from class mean | "Far from class average — second look (never auto-changed)." |
| VAL-COLSWAP-01 | warning | class-wide CA≪Exam inversion heuristic | "Whole class CA unusually low vs Exam — columns swapped?" |
| VAL-COMLEN-01 | blocking | chars > box | "Comment 40 chars too long for box." |

Thresholds tunable per school (versioned). Pilot defaults above.

### 4.3 REP integrity
- REP-INT-01: concurrent edit invalidates draft → regenerate.
- REP-INT-02: field≠source-hash → abort student, log, notify.
- REP-INT-03: unapproved → DRAFT watermark, no signature.

## 5. Pack Schemas (v0)
`grading_scales.json`: `[{min:70,grade:"A",label:"Excellent"},...]`
`weights.json`: `{subject_id_or_code: [{assessment:"CA1",max:20,weight:20},...]}`
`comments/*.csv`: `id,subject,band,trend,tone,locale,text(min {name} {subject} ...),max_chars`
`checks/*.yaml`: `{rule_id, enabled, params:{jump_pts:25, sd:3}}`

## 6. Migration & Seeding
- Migrations numbered `0001_init.sql...`, tested up+down on copy.
- Demo dataset: 60 synthetic students, 3 classes, 5 subjects, 1 term with seeded errors (each VAL rule ≥2 positives).
*End — engine + hub MUST conform to this file; deviations need ADR.*
