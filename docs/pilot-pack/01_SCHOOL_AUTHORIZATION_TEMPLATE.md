# School Authorization for an Agent Mark Pilot

**Template — school counsel/DPO to review and complete. This is not legal advice.**

**School:** ______________________
**Address:** ______________________
**Pilot owner (Head):** ______________________
**Data protection officer/counsel:** ______________________
**Hub administrator(s):** ______________________
**Pilot period:** __________ to __________

## 1. Purpose and scope

The school authorizes a controlled pilot of Agent Mark Hub for:

- [ ] one class / one term (specify): ______________________
- [ ] one school / one shared staffroom Windows PC
- [ ] mobile companion with encrypted local storage and explicit `.agmm` transfer only
- [ ] synthetic/shadow data only (no real PII)

**Out of scope:** cloud sync, relay, remote access by Agent Mark, phone pairing beyond the explicit
transfer file, and any processing of student data by the vendor.

## 2. Data categories

- [ ] Student identifier/short code
- [ ] First and last name
- [ ] Class/stream
- [ ] Assessment scores
- [ ] Teacher comments
- [ ] Validation flags/dispositions
- [ ] Draft/final reports and signatures
- [ ] Staff account names and audit events

Special-category or sensitive data (health, religion, ethnicity, disability, safeguarding notes) is
**not** authorized unless separately listed and approved: ______________________________

## 3. Legal basis and notices

The school confirms that its counsel/DPO has:

- [ ] identified the legal basis for processing children's education records under NDPA 2023 and
      applicable school policy;
- [ ] approved the staff/parent privacy notice and any consent/notice step required;
- [ ] confirmed whether a DPIA is required and approved it;
- [ ] confirmed the retention period and data-subject request process;
- [ ] confirmed the breach-notification decision path and contacts.

## 4. Access and custody

- [ ] Access is limited to named staff: ______________________________
- [ ] Each staff member has a personal account; no shared login.
- [ ] The recovery code is sealed and held by: ______________________
- [ ] Backup custodians: ______________________
- [ ] Agent Mark receives no student data, backups, passphrases, or recovery codes.
- [ ] Support is limited to synthetic/redacted examples unless a separate written authorization is
      signed.

## 5. Local-only processing

- [ ] The desktop app stores the encrypted vault locally on the school PC.
- [ ] Backups are encrypted and stored at the school-approved primary/secondary locations.
- [ ] Mobile data stays in the encrypted local store and moves only by explicit `.agmm` transfer.
- [ ] No cloud relay, always-on sync, telemetry, analytics, or AI processing is authorized.
- [ ] The school will not place the data folder or backups in a personal cloud-sync folder.

## 6. Retention, deletion, and offboarding

- [ ] Retention schedule: ______________________
- [ ] Deletion/erasure method: app delete/purge plus backup destruction under the schedule.
- [ ] Offboarding wipe owner: ______________________
- [ ] Legal-hold exceptions: ______________________

## 7. Incident cooperation

The school will notify the hub admin and Agent Mark lead immediately of a suspected loss, theft,
unauthorized access, wrong-recipient export, or malware event. The DPO/counsel decides on regulator
and data-subject notification. Agent Mark will provide technical facts and preserve evidence; it will
not make the notification decision for the school.

## 8. Conditions and limitations

- Real data may not be loaded until the technical, school/legal, and independent-review gates are
  green.
- An unsigned build may be used only for an explicitly accepted internal pilot and never published
  as a production release.
- The school may stop the pilot at any time; the stop conditions are in the runbook.

## 9. Signatures

Head: ______________________  Date: __________

DPO/counsel: ______________________  Date: __________

Hub admin: ______________________  Date: __________

Agent Mark lead: ______________________  Date: __________
