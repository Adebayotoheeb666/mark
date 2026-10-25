# Agent Mark — Comment Bank Guide
**Status:** Phase 3 built | **Bank:** 24 starters (MATHS+ENG × A/B/C/D/F, mixed trend/tone)

## Flow (3 taps + edit)
Band → Trend → Tone → sentence → live preview (`{name, subject, score, strength, next_step}` filled) → edit inline → save.
Modes: as-is (`edited=false`), edited, custom (`template_id=null`). Char counter blocks over-box saves (VAL-COMLEN-01).

## Writing standards
One strength + one next step per comment; <210 chars default; no comparative/shaming language; tone matches band (encouraging A–C, firm D, formal F).
Placeholders required: `{name}` + `{subject}`; optional `{score} {strength} {next_step}` (missing → empty, never crash).

## Coverage rule
Every (subject, band) ≥1 template; gaps listed by `CommentBank.coverage()`. Teacher reuse target >60% as-is/light-edit (measured in pilot via `usage`/`edited` counters — template IDs only, no PII).
