# Agent Mark Pilot Deployment Runbook

**Status:** internal pilot candidate. This runbook does **not** authorize real student data by
itself. Real PII may be loaded only after the school/legal pack and the independent review gate are
signed. See `docs/REAL_DATA_READINESS.md`.
**Scope:** one school, one shared staffroom Windows 10/11 PC, local staff accounts, desktop as the
system of record, mobile as an encrypted local companion with explicit `.agmm` transfer.
**Compliance context:** Nigeria NDPA 2023. The school's counsel/DPO must confirm the legal basis,
notices, retention, and breach-notification path. This runbook is operational guidance, not legal
advice.

---

## 1. Roles and custody

| Role | Who | Owns |
|---|---|---|
| Pilot owner | School Head | Go/no-go, staff authorization, final sign-off |
| Data protection | School DPO/counsel | DPIA, notices, data-subject requests, breach decision |
| Hub admin | Named exams/IT staff member | Install, accounts, backups, restore drills, purge |
| Head reviewer | School Head or delegated head | Final report approval and lock/sign |
| Teachers | Named staff | Score entry, corrections, comments, first review |
| Viewer | Optional IT/auditor | Read-only oversight |
| Agent Mark support | Vendor | No PII by default; support only through an authorized, recorded channel |

**Custody rules**
- At least two named staff know where the recovery code is sealed. Neither may keep it on the same
  PC or in the same bag as the PC.
- The hub admin password is personal. No shared "admin" login, no password in a shared document.
- The school owns the data folder, backups, recovery code, and the decision to delete them.
- Agent Mark does not receive student data, backups, or passphrases. Support screenshots must be
  synthetic or redacted.

---

## 2. Preconditions before real data

Do not proceed until every item is checked and evidence is filed.

- [ ] Signed school authorization (template `01_SCHOOL_AUTHORIZATION_TEMPLATE.md`).
- [ ] DPIA approved by the school DPO/counsel (`02_DPIA_TEMPLATE.md`).
- [ ] Privacy notice issued to staff and, where required, parents/guardians
      (`03_PRIVACY_NOTICE_TEMPLATE.md`).
- [ ] Retention and backup schedule agreed (`04_RETENTION_AND_BACKUP_SCHEDULE.md`).
- [ ] Incident response contacts and decision path agreed (`05_INCIDENT_RESPONSE_TEMPLATE.md`).
- [ ] Data-subject request procedure agreed (`06_DATA_SUBJECT_REQUEST_PROCEDURE.md`).
- [ ] Staff training completed (`07_STAFF_TRAINING_AND_DEVICE_CHECKLIST.md`).
- [ ] Local-only roles statement/DPA signed (`08_DPA_LOCAL_ONLY_STATEMENT.md`).
- [ ] Independent security review closed Critical/High findings; reviewer sign-off filed.
- [ ] Windows artifacts are signed with the school-approved OV certificate, or the school has
      explicitly accepted an unsigned internal pilot build in writing for a controlled test.
- [ ] Android APK, if used for real data, is release-signed and its keystore custody is documented.
- [ ] A witnessed backup + restore drill has passed on the pilot PC.
- [ ] Pilot charter: cohort, start/end dates, success criteria, stop conditions, rollback owner.

---

## 3. Install the desktop hub

### 3.1 Choose the artifact

| Artifact | Use | Notes |
|---|---|---|
| `Agent-Mark-Hub-<version>-x64-setup.exe` (NSIS) | Normal per-user install | No admin prompt; installs for the current Windows user |
| `Agent-Mark-Hub-<version>-x64.msi` | School IT / per-machine | Administrator required; suitable for Intune/GPO |
| `Agent-Mark-Hub-<version>-windows-x64-portable.zip` | USB / no-install trial | Keep `WebView2Loader.dll` beside the exe |

Verify the SHA-256 against `SHA256SUMS.txt` before running anything. For a signed build, verify the
signature on a clean PC:

```powershell
Get-FileHash .\Agent-Mark-Hub-0.2.0-x64-setup.exe -Algorithm SHA256
signtool verify /pa /v .\Agent-Mark-Hub-0.2.0-x64-setup.exe
```

An unsigned build must be labelled **internal pilot only** and must not be published or emailed as a
production installer.

**Internal pilot artifact check (2026-10-27):** the unsigned NSIS per-user silent install/uninstall
passed into a clean temporary directory, the portable ZIP extracted and launched, and the MSI
administrative extraction passed. A real per-machine MSI install/upgrade still needs the school's IT
test PC. These checks do not replace the independent review.

### 3.2 First launch and recovery kit

1. Launch the app on the pilot PC as the named hub admin Windows user.
2. Enter the school name, admin username, and a unique 12+ character password.
3. The recovery code is shown **once**. Print it, seal it, and store it in the school safe or another
   approved offline location. Do not photograph it on a personal phone.
4. Sign in and confirm the dashboard shows **DEMO** mode.
5. Record the install date, version, artifact hash, Windows user, and recovery-code custodian in the
   pilot evidence log.

### 3.3 Device hardening

Complete `07_STAFF_TRAINING_AND_DEVICE_CHECKLIST.md`. At minimum:

- BitLocker on the system drive, recovery key escrowed by the school.
- Windows updates current; supported antivirus/EDR active.
- Daily work uses a standard Windows account; local admin only for install/update.
- Screen lock on idle; staff lock the hub when leaving the desk.
- No personal cloud-sync folder for the data directory or backups.
- Physical lock/secure staffroom storage for the PC and backup media.

---

## 4. Staff accounts and training

1. As hub admin, open **Users** and create one account per person with the least-privilege role.
2. Hand the temporary password over in person; the user must change it at first sign-in.
3. Never create a shared account. If a person leaves, remove their account the same day.
4. Train each user on:
   - locking the hub and the Windows session;
   - entering and correcting scores with a reason;
   - approving only reports they have actually reviewed;
   - never putting real data in support tickets, chat, email, or personal devices;
   - reporting a lost device, suspected disclosure, or wrong-recipient export immediately.

---

## 5. Load real data (only after the gate is green)

1. **Clear demo data** on the Backup page.
2. **Backup now** and **Verify latest**.
3. **Run restore drill**; confirm the counts, report hashes, and audit chain match.
4. Acknowledge the privacy notice.
5. Enter school details if not already set.
6. **Enable real data**. The dashboard must show **REAL DATA**.
7. Import the roster with a dry run first. Use the exact header
   `short_code,first_name,last_name,class_label`; quoted commas are supported. Fix every dry-run
   error before the real import.
8. Enter or import scores. Use the correction flow with an 8+ character reason; never delete and
   re-enter a score to hide a correction.
9. For mobile, use a separate 12+ character transfer passphrase. Dry-run the `.agmm` import, then
   import once. Keep the phone passcode and transfer passphrase distinct.

**Stop immediately** if the app shows a mode other than REAL DATA, a warning you do not understand,
a duplicate/conflict you cannot explain, or a backup/drill failure.

---

## 6. Daily, weekly, and term operations

### Daily
- Lock the hub when leaving the desk; lock Windows.
- Check the dashboard warning list before bulk changes.
- After significant entry, create a backup and verify it.

### Weekly
- Confirm the last backup is less than 7 days old. If the dashboard warns, back up before continuing.
- Copy the newest verified backup kit to the secondary/off-site location.
- Review the audit log for unexpected account, import, delete, or real-mode actions.

### Term / report cycle
- Back up before drafting, before locking, and after the term's reports are signed.
- Teacher review → head review → head lock/sign. Admin cannot approve or lock.
- Export or print only the minimum needed. Treat every PDF/print as personal data.
- Run a restore drill at least monthly and before a new term.

### Backup kit contents
A verified backup kit includes the encrypted snapshot, its signed manifest, and the
`vault-BK-*.json` wrapped-key copy. Keep the kit together; a snapshot without its manifest/vault copy
is not a complete recovery kit. Store one copy off the PC and one off-site, both encrypted and
access-controlled.

---

## 7. Retention and pruning

Use the school-approved schedule in `04_RETENTION_AND_BACKUP_SCHEDULE.md`. The app does not prune
automatically.

- Keep at least the last 10 daily backups, 3 term-end backups, and 1 yearly backup, unless the
  school's policy requires longer.
- Prune only after a newer verified backup and a successful drill.
- Delete expired backups from **both** primary and secondary locations; deleting only the PC copy
  leaves personal data off-site.
- Record every deletion: date, backup IDs, reason, approver.
- Deleting a student in the app does not delete older backups. If erasure requires backup deletion,
  follow the approved retention/erasure decision and document it.

---

## 8. Staff departure and key rotation

The app does not rotate the data key automatically. Treat a departure with access to the hub or a
backup kit as a key-custody event.

1. Remove the staff account in **Users** the same day. This stops new unlocks with that account.
2. Change the passwords of every remaining account.
3. If the departing person had the recovery code, backup kit, or an exported file, treat it as a
   potential incident and consult the DPO.
4. Destroy backups and exports the departing person could access, subject to the retention/legal
   hold decision. Record the destruction.
5. If the school requires cryptographic rotation, rebuild the hub under a new data key, re-import
   only the approved current data, and destroy the old vault/backups. This is a planned migration,
   not an in-app button.
6. Record the date, accounts changed, backups destroyed, and approver in the pilot evidence log.

---

## 9. Data-subject requests

Use `06_DATA_SUBJECT_REQUEST_PROCEDURE.md`. In the app:

- **Access/export:** Students → **Export** produces a JSON data-subject export for one student. It
  includes student details, scores, comments, flags, and reports. Store it in the approved secure
  location; delete it when the request is closed.
- **Correction:** Students → **Edit** for name/class; Scores → **Correct** for a score. A correction
  appends an immutable version and records the reason.
- **Erasure:** Students → **Delete** requires typing the student code and removes live scores,
  comments, flags, and reports. The audit log remains. Backups remain until retention/erasure
  handling is completed.
- **Offboarding/full purge:** Backup → **Purge all live data** requires typing `PURGE`. It clears
  live students/scores/flags/comments/reports, resets demo mode, keeps the audit log, and does not
  delete backups. Delete the data folder and backups separately for a full wipe.

Never send an export by personal email or WhatsApp. Use the school's approved secure transfer method
or hand it over in person with an acknowledgement.

---

## 10. Incident response

Follow `05_INCIDENT_RESPONSE_TEMPLATE.md`. Immediate actions:

1. **Contain:** lock the hub, lock/disable the Windows account, take the PC offline if malware or
   unauthorized access is suspected, and preserve the device.
2. **Preserve evidence:** do not wipe or reinstall; record times, accounts, screens, and actions. Keep
   the audit log and backups.
3. **Notify:** contact the school Head/DPO immediately. The DPO/counsel decides whether the NDPC,
   parents/guardians, or others must be notified and within what statutory timeline. Do not promise a
   notification timeline you have not confirmed.
4. **Assess:** what data, which students, how many records, whether the vault/backup/export was
   encrypted, and whether a passphrase/recovery code was exposed.
5. **Recover:** restore from a verified backup on a clean PC, rotate passwords/recovery code, and
   re-run the drill. Do not restore an infected backup without review.
6. **Record:** incident log, decisions, notifications, remediation, and lessons learned.

---

## 11. Update, rollback, and restore to a new PC

### Update
1. Read the release notes and verify the new artifact hash/signature.
2. Create and verify a backup; run a drill.
3. Install the new version over the old one (NSIS per-user or MSI per-machine; the MSI upgrade code
   is pinned).
4. Launch, sign in, confirm counts and mode, and run a small read-only check.
5. Keep the previous installer and backup kit until the new version has passed the pilot check.

### Rollback
1. Stop using the new version.
2. Keep the data folder and a copy of the current vault for investigation.
3. Install the previous signed version.
4. Restore the pre-update backup if the new version changed data incompatibly; otherwise reopen the
   current vault with the previous version only after confirming schema compatibility.
5. Record what was rolled back and why.

### Restore to a new PC
1. Install the same or newer version on the clean PC.
2. Copy the backup kit (`*.agm`, matching manifest, `vault-BK-*.json`) to the new PC.
3. Launch; if `hub.db`/`vault.json` are missing, the app offers first-run recovery from the kit.
4. Unlock with an account password, restore, and verify counts/audit chain.
5. Re-run a drill, rotate passwords, and destroy the old PC's data folder/backups under the
   retention/incident decision.

---

## 12. Offboarding / full wipe

1. Export anything the school must retain under its retention policy.
2. Create a final backup only if retention requires it; label it clearly.
3. Backup → **Purge all live data** (`PURGE`).
4. Sign out, close the app, and delete the data folder:
   `%APPDATA%\org.agentmark.hub\agent-mark-hub\`.
5. Delete the backups folder and every secondary/off-site copy that is not under legal hold.
6. Uninstall the app; remove the recovery code from the safe or mark it destroyed.
7. Record the wipe: date, operator, approver, backup IDs destroyed, and any retained legal-hold
   copies.

---

## 13. Go/no-go and stop conditions

**Go only if:** all Section 2 items are checked; the dashboard is REAL DATA; the last backup is
verified and fresh; a drill passed; staff training is complete; the rollback owner and contact tree
are known.

**Stop and escalate if:**
- real mode cannot be enabled or the mode badge is unexpected;
- a backup/verify/drill fails, or the backup is stale and cannot be refreshed;
- a student/score/report count is wrong and cannot be explained;
- an account, export, or backup may have been accessed without authorization;
- the PC is lost, stolen, infected, or repaired by an unknown party;
- a staff member with access leaves and key custody is unclear;
- the school/legal/independent-review gate is no longer green.

**Evidence log:** keep the signed authorization, DPIA, notices, training roster, artifact hashes,
signature verification, backup/drill records, incident log, data-subject requests, and wipe records
together for the pilot review.
