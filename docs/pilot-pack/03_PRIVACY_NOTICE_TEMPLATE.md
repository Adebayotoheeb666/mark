# Privacy Notice Template — Staff, Parents/Guardians, and Students

**Template — school counsel/DPO must review and adapt before use. This is not legal advice.**

**School:** ______________________  **Effective date:** __________
**Contact for data requests:** ______________________

## 1. What this notice covers

The school uses **Agent Mark Hub**, a local-first records system, for the pilot described below.
The desktop application stores records on a school-owned PC; the mobile companion stores records in
an encrypted local app and transfers them only through an explicit encrypted file chosen by staff.
There is no cloud relay, always-on sync, telemetry, analytics, or AI processing in this pilot.

## 2. What we collect

- Student short code/identifier, name, class/stream
- Assessment scores and teacher comments
- Validation flags and their resolution
- Draft/final reports, approval status, and report signatures
- Staff account name and audit events (who did what, when)
- Mobile: the same authorized fields entered on the phone, stored encrypted

We do **not** collect health, religion, ethnicity, disability, safeguarding, or other sensitive data
in this pilot unless the school adds it in a separate approved notice: ______________________

## 3. Why we use it

- To record and calculate assessment results
- To prepare, review, approve, and sign school reports
- To correct errors and respond to data-subject requests
- To keep an audit trail for accountability
- To back up and restore school records

## 4. Legal basis

The school's counsel/DPO has identified the legal basis under the Nigeria Data Protection Act 2023
and school policy. That basis is: ______________________

Where consent is relied on, it can be withdrawn; the school will explain any consequences.

## 5. Who can see it

Named school staff with the least-privilege role (admin, head, teacher, viewer). Agent Mark does not
receive student data, backups, passphrases, or recovery codes by default. Support uses synthetic or
redacted examples unless a separate written authorization is signed.

## 6. Where it is stored and how it is protected

- Desktop: encrypted vault on the school PC; SQLite runs in memory; the key is wrapped by staff
  passwords and a sealed recovery code.
- Backups: encrypted snapshots with signed manifests, stored at school-approved primary and secondary
  locations.
- Mobile: passcode-derived AES-256-GCM encrypted local store; auto-lock; explicit `.agmm` transfer
  with a separate transfer passphrase.
- Device controls: BitLocker, Windows updates, antivirus, standard-user daily accounts, screen lock,
  and physical security.

## 7. How long we keep it

The school's retention schedule is: ______________________

Backups may retain a deleted record until the backup expires under that schedule. The school
documents deletions and destroys expired copies from both primary and secondary locations.

## 8. Your rights

Subject to NDPA 2023 and school policy, you may ask to:

- access a copy of the data;
- correct inaccurate data;
- delete data where the school is not required to retain it;
- object or restrict processing where applicable;
- complain to the school and/or the Nigeria Data Protection Commission.

**How to ask:** contact ______________________ in writing. The school may verify identity and will
respond within the period required by law/policy. The school will explain any lawful exception.

## 9. Sharing and transfers

The pilot does not send student data to a cloud service or another country. If the school later adds
a service or transfer, it will update this notice and complete the required assessment first.

## 10. Incidents

If the school becomes aware of a loss, unauthorized access, or wrong-recipient disclosure, it will
contain the incident, assess the risk, and make any required notifications. Report a concern to
______________________ immediately.

## 11. Changes

The school will date and communicate material changes. The current version is available at
______________________.

**School contact:** ______________________
**DPO/counsel contact:** ______________________
