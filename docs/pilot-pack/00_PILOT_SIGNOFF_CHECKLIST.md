# Pilot Sign-Off Checklist

**School:** ______________________  **Pilot dates:** __________ to __________
**Pilot owner (Head):** ______________________  **DPO/counsel:** ______________________
**Hub admin:** ______________________  **Agent Mark lead:** ______________________

This checklist is the school's record that the pilot is authorized and the technical evidence has
been reviewed. It is not a substitute for the independent security review or legal advice.

## A. Technical evidence

- [ ] Desktop version and artifact hashes recorded: ______________________________
- [ ] `SHA256SUMS.txt` checked; signatures verified (`signtool verify /pa /v`) or unsigned pilot
      acceptance attached.
- [ ] `cargo test` passed: ____ / ____ tests.
- [ ] `e2e_smoke.py` passed on a clean data directory.
- [ ] `ui_smoke.py` passed.
- [ ] `lifecycle_smoke.py` passed (CSV, correction, export, delete, purge, fingerprint).
- [ ] `recover_smoke.py` passed (restore from backup kit with no live DB/vault).
- [ ] `verify_db.py` passed on the pilot data folder.
- [ ] Release binary ignores `AGM_TEST_ALLOW_REAL_DATA=1` (release-gate regression).
- [ ] Backup created, verified, and drilled on the pilot PC; drill artifact filed.
- [ ] Dashboard stale-backup/drill warnings observed and understood.

## B. School/legal pack

- [ ] School authorization signed (`01_SCHOOL_AUTHORIZATION_TEMPLATE.md`).
- [ ] DPIA approved (`02_DPIA_TEMPLATE.md`).
- [ ] Privacy notice issued (`03_PRIVACY_NOTICE_TEMPLATE.md`).
- [ ] Retention and backup schedule signed (`04_RETENTION_AND_BACKUP_SCHEDULE.md`).
- [ ] Incident response contacts and decision path signed
      (`05_INCIDENT_RESPONSE_TEMPLATE.md`).
- [ ] Data-subject request procedure adopted (`06_DATA_SUBJECT_REQUEST_PROCEDURE.md`).
- [ ] Staff training completed and attendance recorded
      (`07_STAFF_TRAINING_AND_DEVICE_CHECKLIST.md`).
- [ ] Local-only roles statement/DPA signed (`08_DPA_LOCAL_ONLY_STATEMENT.md`).

## C. Security review

- [ ] Independent reviewer engaged; scope limited to desktop + mobile local data.
- [ ] Threat model reviewed.
- [ ] Critical findings closed.
- [ ] High findings closed or accepted in writing with an owner/date.
- [ ] Reviewer signed the security opinion.
- [ ] Re-test evidence filed.

## D. Operations

- [ ] Named hub admin and backup custodian trained.
- [ ] Recovery code printed, sealed, and stored off the PC.
- [ ] Primary and secondary backup locations agreed and tested.
- [ ] BitLocker enabled; recovery key escrowed.
- [ ] Windows updates, antivirus, standard-user daily account, screen lock checked.
- [ ] Staff accounts created one per person; no shared login.
- [ ] Rollback owner and previous installer retained.
- [ ] Stop conditions and contact tree briefed to staff.

## E. Decision

- [ ] **GO** — load the agreed real-data cohort.
- [ ] **NO-GO** — keep synthetic/demo data only.

**Conditions / exceptions:**

______________________________________________________________________________
______________________________________________________________________________

**Signatures**

Head: ______________________  Date: __________

DPO/counsel: ______________________  Date: __________

Hub admin: ______________________  Date: __________

Agent Mark lead: ______________________  Date: __________
