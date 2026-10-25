# Agent Mark — Backup, Restore & Key Custody Runbook

**Status:** Draft v1.1 — aligned with Hub 0.2.0 (2026-10-25)
**Applies to:** one school, one shared staffroom Windows PC, desktop hub + encrypted mobile transfer
**Keep:** printed copy in the school safe, plus an offline USB with the installer and a current backup kit
**Review:** termly, and after any staff change

> **Real-data gate.** Do not enter real student names or marks until
> `docs/REAL_DATA_READINESS.md` is green. This runbook is the operational half of that gate; it is not
> a substitute for the independent review or the school/legal pack.

---

## 1. Non-negotiable rule

Before any term lock, report run, bulk import, app update, or staff departure:

1. the live vault opens normally;
2. a **fresh backup** exists;
3. that backup has been **verified** by the app;
4. a **restore drill** has passed on the current PC; and
5. the backup kit (`.agm`, `.json`, and `vault-BK-*.json`) is copied off the PC.

The app enforces a version of this for real-data mode: it will not enable real data until a backup is
verified and a drill passes. It cannot enforce that you copy the kit off the PC. That is a human
procedure.

---

## 2. What is in the data folder

```
%APPDATA%\org.agentmark.hub\agent-mark-hub\
  hub.db                     encrypted vault (magic AGMDB001), not readable SQLite
  vault.json                 staff accounts + Argon2id-wrapped copies of the data key
  backups\
    BK-<time>-<id>.agm       full encrypted database snapshot (magic AGMBK001)
    BK-<time>-<id>.json      signed manifest: counts, SHA-256, audit head, Ed25519 signature
    vault-BK-<time>-<id>.json  wrapped-key vault copy for disaster recovery
    pre-restore-*.db         archived live vault from an in-app restore
    pre-recover-*.db         archived live vault from a disaster recovery
```

- The random 256-bit **data key** encrypts `hub.db` and every backup. It is never written in
  plaintext.
- Each staff password gets its own **Argon2id**-wrapped copy of the data key in `vault.json`
  (64 MiB, t=3, p=1).
- The printed **recovery code** gets another wrapped copy. It is shown once at setup.
- The Ed25519 report-signing key lives inside the encrypted database.
- A backup kit is **self-contained only if `vault.json` (or `vault-BK-*.json`) travels with it**.
  Backups without a vault copy cannot be decrypted after the PC is lost.

---

## 3. Backup targets

| Target | How | Notes |
|---|---|---|
| A. USB drive (primary, off-site) | Copy the `.agm`, `.json`, and `vault-BK-*.json` files | Keep two sticks; rotate. Store one away from the school. |
| B. Second encrypted copy (secondary) | Copy the same three files to a school safe / head's office | Survives a single-PC failure. Do not put student data in a personal cloud account without school approval. |
| C. Optional cloud storage | Upload the same ciphertext files | Only with school/DPO approval. The files are encrypted, but the school still owns the access decision. |

There is **no automatic cloud relay, LAN push, or scheduled backup** in this release. Backups are
manual. Put the daily reminder in the school calendar.

---

## 4. Schedule and retention

- **Daily during an active term:** one backup at the end of the school day.
- **Before:** bulk roster import, mobile `.agmm` import, report generation, term lock, app update,
  staff departure, or any change to staff accounts.
- **After:** adding a user, resetting a password, or changing the recovery code, take a fresh backup so
  the `vault-BK-*.json` copy matches the current accounts.
- **Retention (manual):** keep the last 10 daily kits, 3 term-end kits, and 1 end-of-year kit.
  Delete older kits only after the newer ones have been verified and copied off-site.
- **Stale-backup warning:** the app shows the last backup time; it does **not** yet block on a stale
  backup. The Head/Admin owns the weekly check.

---

## 5. Create and verify a backup (operator steps)

1. Sign in as **admin**.
2. Open **Backup & real-data gate**.
3. Select **Backup now**.
4. The app writes the `.agm`, `.json`, and `vault-BK-*.json` files, verifies the bytes it just wrote,
   and reports the backup ID and SHA-256.
5. Select **Verify latest** and confirm it passes.
6. Copy **all three files** to the primary USB and the secondary target. Do not copy only the `.agm`.
7. Record in the school log: date, backup ID, who copied it, where it went.

A backup is not “done” when the progress bar finishes. It is done when the copy exists off the PC and
the manifest verifies.

---

## 6. Restore drill (required before real data)

1. Sign in as **admin**.
2. Open **Backup & real-data gate**.
3. Select **Run restore drill**.
4. The app decrypts the newest backup into a **fresh in-memory database**, checks `PRAGMA
   integrity_check`, row counts, the content digest, and the audit hash chain. It does not touch the
   live vault.
5. Confirm the dashboard says **drill passed**.
6. Record the drill date and backup ID in the school log.

A failed drill leaves the gate closed. Do not “try again until it passes” without investigating the
backup and the disk.

---

## 7. Normal restore (same PC, app still opens)

Use this when the app opens and you can sign in, but the data is wrong or you need to roll back.

1. Sign in as **admin**.
2. Open **Backup & real-data gate**.
3. Select **Restore latest** (or restore a specific backup if the UI offers the ID).
4. The app verifies the backup first, archives the current `hub.db` as
   `backups\pre-restore-*.db`, replaces the live vault, and writes an audit row.
5. The app sets **drill passed = no**. Run a new drill, then a new backup.
6. Check the student/score/report counts against the school's register.

The archive is a recovery path if you restored the wrong backup. Do not delete `pre-restore-*.db`
until the new state is verified and backed up.

---

## 8. Disaster recovery (new PC, or `hub.db` missing/damaged)

Use this when the app shows the sign-in screen but the vault is gone, or you are rebuilding on a
replacement PC.

### 8.1 Prepare the folder

1. Install the **same or newer** Agent Mark Hub. Do not enter real data.
2. Close the app completely.
3. Create the data folder if it does not exist:
   `%APPDATA%\org.agentmark.hub\agent-mark-hub\`
4. Create `backups\` inside it.
5. From the backup kit, copy:
   - `vault-BK-*.json` → `vault.json` in the data folder;
   - `BK-*.agm` and `BK-*.json` → the `backups\` folder.
6. If the new install already created a `vault.json`, `hub.db`, or their `.bak` copies from a test
   setup, and it contains no real data, remove the test `hub.db`, `vault.json`, `hub.db.bak`, and
   `vault.json.bak`, then place the kit copy at `vault.json`. Never overwrite a vault that may contain
   real data without first archiving it.

### 8.2 Restore

1. Start Agent Mark Hub.
2. On the sign-in screen, select **Restore this PC from a backup**.
3. Enter a username and password from the **old** vault (the kit copy).
4. Leave **Backup ID** blank to use the newest backup, or enter the ID from the manifest.
5. Select **Verify and restore backup**.
6. The app verifies the manifest signature, decrypts the snapshot, checks counts/digest/audit chain,
   archives any current `hub.db`, and replaces the live vault.
7. Run a **new restore drill** and a **new backup** on this PC.
8. Check counts against the school register before entering new data.

### 8.3 If the password is lost

1. On the sign-in screen, use **Forgot password? Use the recovery code**.
2. Enter the username, the sealed recovery code, and a new 12+ character password.
3. Then use **Restore this PC from a backup** with the new password.

The recovery code only works with `vault.json`. If both `vault.json` and every `vault-BK-*.json` copy
are lost, the backups cannot be decrypted. That is the point of the encryption; there is no vendor
backdoor.

---

## 9. Staff departure and key custody

- The recovery code is held by the **Head/DPO** in a sealed envelope in the school safe, with a copy
  in a second sealed location. It is never stored on the PC, in email, or in a shared drive.
- Each staff member has their own account. Do not share passwords. A shared staffroom PC is not a
  shared login.
- On departure, the Head/Admin should:
  1. take a fresh verified backup;
  2. reset the departing user's password to a random temporary value (or remove the account when
     account removal is available in the build);
  3. confirm the departing user cannot sign in;
  4. record the change in the audit log and the school log.
- **Key rotation is not yet a one-click feature.** If a password may be compromised, treat the vault
  as exposed while it was unlocked, take a backup, change every account password, and consider a
  restore from a pre-compromise backup. The data key itself is not automatically rotated.
- Enable **BitLocker** on the PC as defence in depth. The encrypted vault is the primary control;
  BitLocker protects the rest of the disk (Windows account data, temp files, the app itself).

---

## 10. Incident response (lost/stolen PC or USB)

1. **Do not** attempt to recover data from a stolen device by installing tools on a school PC.
2. Record the time, device, and what it contained. Notify the Head/DPO the same day.
3. The vault and backups are encrypted. A thief has ciphertext plus Argon2id-wrapped keys, not student
   records. Change the account passwords from a clean PC and take a fresh backup.
4. If the stolen device was unlocked or a password was written down, treat it as a data breach and
   follow the school's NDPA incident procedure (containment, risk assessment, notification decision,
   regulator path).
5. Restore onto a clean replacement PC using section 8.
6. Preserve the audit log and the backup manifests for the investigation.

There is **no remote wipe** in this release. The phone companion has a local “Wipe this phone” button;
the desktop hub does not have remote wipe.

---

## 11. Mobile `.agmm` transfer

1. On the phone, set a passcode (8+ characters), enable real data only after the app's gate, and
   export an encrypted `.agmm` file with a separate 12+ character transfer passphrase.
2. Move the file to the desktop by USB, local file share, or another method the school approves.
3. On the desktop, sign in as **admin**, open **Students → Mobile transfer**, enter the transfer
   passphrase, and run **Dry run** first.
4. Resolve roster/score conflicts. Then run the real import. Real import requires **real-data mode**.
5. The desktop records an audit row and is idempotent: re-importing the same file does not duplicate
   students or scores.
6. Delete the `.agmm` file from the phone and the transfer location after a successful import.

The transfer file is encrypted with AES-256-GCM under the transfer passphrase. It is not the desktop
password and it is not the phone passcode. Losing the transfer passphrase means re-exporting from the
phone.

---

## 12. Offline verification

The app's own **Verify latest** and **Drill** are the first check. For an independent check, run:

```powershell
python hub-desktop\tools\verify_db.py "%APPDATA%\org.agentmark.hub\agent-mark-hub" --user admin
```

It prompts for the password, opens the encrypted vault read-only, re-computes the audit chain,
verifies every locked report signature, and verifies every backup manifest, signature, decryption,
counts, audit head, and plaintext-leak check. Expected output ends with `RESULT: PASS`.

---

## 13. Open operational gaps (do not pretend these are done)

- No automatic backup scheduler, stale-backup block, or retention pruning.
- No one-click key rotation or account removal UI.
- No remote wipe for the desktop hub.
- No signed installers yet; SmartScreen will warn.
- No independent security review yet.
- School authorization, DPIA/DPA, parent notice, training, and the incident contact tree are not
  signed.

Close these in `docs/REAL_DATA_READINESS.md` before real data.
