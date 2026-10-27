# Data Protection Impact Assessment (DPIA) Template — School Pilot

**Template — complete with the school's DPO/counsel. This is not legal advice.**
**School:** ______________________  **Assessment date:** __________
**Assessor(s):** ______________________  **Approver:** ______________________

## 1. Processing description

| Item | Answer |
|---|---|
| Purpose | Local school records: roster, scores, comments, validation flags, reports, approvals/signatures |
| Data subjects | Students (children), staff account holders |
| Data categories | Short code, name, class, scores, comments, flags, reports, staff usernames/audit events |
| System | Agent Mark Hub desktop (local encrypted vault); mobile companion (encrypted local store + explicit transfer) |
| Location | School-owned Windows PC and school-approved backup media |
| Recipients | Named school staff only; no vendor/cloud recipient by default |
| Transfers | No cross-border or cloud transfer in the pilot; `.agmm` file is moved by the school |
| Retention | Per school schedule: ______________________ |
| Legal basis | School counsel/DPO to confirm under NDPA 2023 and school policy |

## 2. Necessity and proportionality

- [ ] The data is necessary for the authorized school purpose and limited to that purpose.
- [ ] Only the minimum fields needed for the pilot are collected.
- [ ] Access is role-based and limited to named staff.
- [ ] The pilot avoids cloud sync, telemetry, AI, and vendor access.
- [ ] Retention is no longer than the school's policy requires.
- [ ] Mobile use is limited to an encrypted local store and explicit transfer.

## 3. Risks and mitigations

| Risk | Likelihood/impact | Mitigation | Residual risk / owner |
|---|---|---|---|
| Lost/stolen PC exposes records | Medium/High | Whole-DB XChaCha20-Poly1305 vault; BitLocker; screen lock; no plaintext DB/WAL | |
| Weak/shared staff password | Medium/High | Argon2id; 12+ char passwords; personal accounts; throttling; training | |
| Backup lost or tampered | Medium/High | Encrypted snapshot + signed manifest; verify; drill; primary/secondary custody | |
| Wrong-recipient export/print | Medium/High | Role checks; audited export; minimum data; secure handover; training | |
| Staff departure/key custody | Medium/High | Remove account; rotate passwords; destroy accessible backups; incident review | |
| Mobile device loss | Medium/High | Passcode-derived AES-GCM store; auto-lock; no plaintext files; wipe procedure | |
| Report tampering/dispute | Medium/High | Immutable score versions; approvals; Ed25519 signature; audit chain; fingerprint | |
| Malware on shared PC | Medium/High | Antivirus/EDR; updates; standard user; no personal software; incident plan | |
| Vendor support sees PII | Low/High | No vendor access by default; synthetic/redacted support; written authorization only | |
| Over-retention in backups | Medium/Medium | Retention schedule; prune primary+secondary; document deletion | |

## 4. Data-subject rights

- [ ] Access/export procedure documented and tested (student export JSON).
- [ ] Correction procedure documented and tested (student edit, score correction).
- [ ] Erasure procedure documented and tested (student delete, live purge, backup destruction).
- [ ] Response owner and timeline agreed with counsel/DPO: ______________________
- [ ] Identity verification and secure handover method agreed.

## 5. Consultation and decision

- [ ] Staff/student/parent notice reviewed.
- [ ] DPO/counsel consultation completed.
- [ ] If a high residual risk remains, the pilot does not start until it is reduced or explicitly
      accepted by the Head/DPO.

**Decision:** [ ] Approved  [ ] Approved with conditions  [ ] Not approved

**Conditions:**

______________________________________________________________________________
______________________________________________________________________________

**Signatures**

DPO/counsel: ______________________  Date: __________

Head: ______________________  Date: __________
