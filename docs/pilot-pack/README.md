# Pilot Pack

Templates for the first single-school Agent Mark pilot. They are **templates**, not legal advice and
not an authorization to load real student data. The school's Head, DPO/counsel, and IT lead complete
and sign them.

| File | Purpose |
|---|---|
| `00_PILOT_SIGNOFF_CHECKLIST.md` | One-page technical + school/legal + review + operations sign-off |
| `01_SCHOOL_AUTHORIZATION_TEMPLATE.md` | Named scope, data categories, access, custody, retention |
| `02_DPIA_TEMPLATE.md` | NDPA 2023 children's-data DPIA with risks and mitigations |
| `03_PRIVACY_NOTICE_TEMPLATE.md` | Staff/parent/student notice, rights, contacts |
| `04_RETENTION_AND_BACKUP_SCHEDULE.md` | Retention, backup cadence, pruning, erasure, wipe |
| `05_INCIDENT_RESPONSE_TEMPLATE.md` | Containment, assessment, notification decision, evidence |
| `06_DATA_SUBJECT_REQUEST_PROCEDURE.md` | Access, correction, export, erasure using the app |
| `07_STAFF_TRAINING_AND_DEVICE_CHECKLIST.md` | Training acknowledgement and device hardening |
| `08_DPA_LOCAL_ONLY_STATEMENT.md` | Controller/supplier roles for a local-only deployment |

Operational instructions are in `docs/PILOT_DEPLOYMENT_RUNBOOK.md`. The go/no-go gate is in
`docs/REAL_DATA_READINESS.md`.

**Rule:** do not load real PII until the signed school pack and the independent review gate are
green. An unsigned internal pilot build is not a production release.
