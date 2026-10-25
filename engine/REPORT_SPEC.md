# Agent Mark — Report Spec (REP)
**Status:** Phase 4 built | **Template:** ng-secondary-rep@1.4.0

## Workflow
`draft (DRAFT watermark, no sig) → teacher review → head approve+lock (sign) → version chain on correction`.
Lock requires: snapshot hash match (REP-INT-01) + teacher review present (REP-INT-03). Mismatch aborts that student only (REP-INT-02).

## Artifacts
- `report_id = RPT-{term}-{student_code}-v{n}`; `hash = sha256(canonical payload)`; `sig = ed25519(payload)` (hmac-demo fallback in Python ref only); `qr = AGM1:{id}:{hash}:{sig}`.
- Batch file: `{Year}_{Term}_{Class}_{StudentID}.pdf` (HTML renderer in ref; headless-Chromium PDF in hub build).
- Footer (locked): `Report {id} · {class} · {term} · Rules {rule_ver} · Pack {tpl_ver} · Hash {short} · Approved {teacher}, {head}`.

## Verification (inspector)
Recompute hash from payload → check sig with hub pubkey → scan QR → compare. Tampered grade ⇒ verify False. Old versions retained; corrections bump version + reset approvals.
