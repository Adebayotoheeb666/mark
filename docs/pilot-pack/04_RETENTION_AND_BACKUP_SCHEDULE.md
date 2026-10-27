# Retention and Backup Schedule

**School:** ______________________  **Approved by:** ______________________
**Effective date:** __________  **Review date:** __________

This schedule is the school's instruction to the hub admin. The app warns about stale backups and
drills but does **not** prune automatically. Delete backups from every location, not just the PC.

## 1. Live data retention

| Data | Retention | Trigger for deletion | Owner |
|---|---|---|---|
| Student roster/name/class | While enrolled + ______ years | Graduation/transfer + retention period | |
| Scores | ______ years | End of retention period | |
| Comments/flags | ______ years | End of retention period | |
| Reports/signatures | ______ years | End of retention period | |
| Staff accounts/audit | ______ years | Account removal + retention period | |
| Data-subject exports | Until request closed, max ______ days | Secure handover/closure | |
| Incident records | ______ years | Legal/insurance requirement | |

Legal holds override this schedule; record the hold and do not delete until released by counsel.

## 2. Backup cadence

| Backup type | When | Keep | Location(s) |
|---|---|---|---|
| Daily | Each working day after entry | Last 10 | PC backups folder + secondary |
| Pre-change | Before import, term lock, upgrade, purge | Until change verified | PC + secondary |
| Term-end | End of each term | 3 most recent | Primary + off-site |
| Yearly | End of academic year | 1 | Off-site |
| Incident | Before/after recovery | Until incident closed | Secure evidence location |

**Minimum rule:** do not let the only verified backup sit on the same PC. Keep one copy off the PC
and one off-site. Encrypt backup media and control access.

## 3. Verification and drills

- Every backup: **Verify latest** must pass.
- At least monthly and before a new term: **Run restore drill** must pass.
- Record: date/time, backup ID, counts, audit-chain result, operator, and any anomaly.
- A failed verify/drill blocks further bulk changes until resolved.

## 4. Pruning procedure

1. Confirm a newer verified backup exists and a drill passed.
2. Identify backups beyond the retention above.
3. Delete the selected backup files (snapshot + manifest + matching `vault-BK-*.json` where it is a
   standalone kit) from the PC and every secondary/off-site copy.
4. Do not delete the only copy of a backup under legal hold.
5. Record: date, backup IDs, locations, reason, approver.
6. Spot-check that the deleted files are gone and that the remaining newest backup still verifies.

## 5. Erasure and backups

Deleting a student in the app removes live records but not older backups. For an erasure request:

- [ ] Delete/export as appropriate in the app.
- [ ] Determine whether the school must retain the backup for legal/accounting reasons.
- [ ] If deletion is required, prune the affected backups under this schedule and record it.
- [ ] If retention is required, record the legal basis and the date the backup will age out.
- [ ] Do not promise the data subject that every backup copy is gone until it is true.

## 6. Offboarding wipe

On school closure, vendor change, or pilot end:

1. Export retained records.
2. Purge live data in the app (`PURGE`).
3. Delete the data folder `%APPDATA%\org.agentmark.hub\agent-mark-hub\`.
4. Delete primary and secondary backups not under legal hold.
5. Uninstall the app and destroy the sealed recovery code.
6. Record the wipe and approver.

**Signatures**

Head: ______________________  Date: __________

DPO/counsel: ______________________  Date: __________
