# Local-Only Roles Statement / Data Processing Agreement Template

**Template — school counsel/DPO and Agent Mark to review. This is not legal advice.**

**School (controller):** ______________________
**Agent Mark (supplier):** ______________________
**Effective date:** __________  **Pilot period:** __________ to __________

## 1. Roles

The school determines the purposes and means of processing student records and is the **controller**
under the Nigeria Data Protection Act 2023. Agent Mark supplies a local-first software product and
does not receive student personal data by default.

Where Agent Mark personnel access a school system or a redacted/synthetic copy for support, they act
as an authorized processor or independent contractor only for that documented task, for the period
and purpose stated in a separate written support authorization.

## 2. Scope of processing

- Local desktop vault on the school PC.
- Encrypted backups at school-approved locations.
- Mobile companion with encrypted local storage and explicit `.agmm` transfer.
- No cloud relay, always-on sync, telemetry, analytics, AI, or vendor-side student database.
- No cross-border transfer of student data by Agent Mark in this pilot.

## 3. School responsibilities

- Obtain the legal basis and issue the required notices.
- Limit access to named, trained staff with least-privilege roles.
- Keep the recovery code and backups under school custody.
- Maintain BitLocker, updates, antivirus, and physical security.
- Decide retention, erasure, legal holds, and data-subject responses.
- Decide and make any regulator/data-subject notifications.
- Not put the data folder/backups in personal cloud storage.

## 4. Agent Mark responsibilities

- Provide the software and technical documentation as delivered.
- Not collect student data, backups, passphrases, or recovery codes by default.
- Not enable remote access or telemetry without a separate written authorization.
- Use synthetic or redacted data for support unless a specific written authorization says otherwise.
- Preserve confidentiality of any school information actually received.
- Provide technical facts for an incident and cooperate with the school's investigation.
- Notify the school promptly of a suspected vulnerability or compromise affecting the product.

## 5. Security measures

The product uses local accounts (Argon2id), a whole-database XChaCha20-Poly1305 vault, in-memory
SQLite, encrypted backups with signed manifests, Ed25519 report signatures, an audit hash chain, and
role checks in Rust. These are technical measures, not a substitute for the school's device, access,
and operational controls.

## 6. Subprocessors and transfers

None for student data in the local-only pilot. If the school later adds a cloud, relay, or support
service, the parties will update this statement, complete a DPIA/transfer assessment, and document
the subprocessor before use.

## 7. Incidents

The school notifies Agent Mark of a suspected product-related incident. Agent Mark notifies the school
of a suspected product vulnerability or compromise. The school's DPO/counsel decides on regulator and
data-subject notification; Agent Mark provides technical facts and reasonable cooperation.

## 8. Return and deletion

Agent Mark holds no student data to return. The school retains and deletes its vault, backups, and
exports under its retention schedule and the runbook. Any support copy is returned or destroyed at
the end of the authorized task and recorded.

## 9. Term and termination

This statement covers the pilot period. On termination, the school completes the offboarding wipe or
retains data under its records policy. Surviving obligations: confidentiality, incident cooperation,
and any agreed security commitments.

## 10. Signatures

School Head: ______________________  Date: __________

DPO/counsel: ______________________  Date: __________

Agent Mark lead: ______________________  Date: __________
