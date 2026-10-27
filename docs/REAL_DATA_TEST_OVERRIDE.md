# Test-Only Real-Data Override

**Status:** test/debug only. This does **not** close the production real-data gate in
`docs/REAL_DATA_READINESS.md`.

The normal build refuses to enter `data_mode = real` until the school name is set, a backup is
verified, a restore drill has passed, the privacy notice is acknowledged, and no demo rows remain.
That gate stays in place for every release installer.

This override exists so developers and evaluators can exercise the real-data workflow before the
school/legal, audit and signing gates are complete.

## How the override is gated

The override is only available when **all** of these are true:

1. The binary is a debug build (`cfg!(debug_assertions)`) or was explicitly built with
   `--features allow-real-data-test`. The release installers are built without that feature.
2. The process has `AGM_TEST_ALLOW_REAL_DATA=1` in its environment.
3. The signed-in account has the `admin` role.
4. The database has **zero** demo students/scores/reports. Clear demo data first.
5. The caller supplies a reason of at least 12 characters. The reason is written to the audit log
   as `real_mode.test_override`, together with the actor and timestamp.

The app then sets `data_mode = real`, `test_override = yes`, and shows a red **REAL DATA TEST MODE**
banner on the dashboard and backup screen. `backup_verified`, `drill_passed` and `privacy_ack` stay
`no`, so the readiness checklist remains honest.

## Run it

From the repo root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1 -Build
```

The script builds the debug binary if needed, uses a separate data directory
(`%TEMP%\agent-mark-test-real` by default), sets the environment variables, and starts the app.

Then:

1. Sign in as an admin.
2. Open **Backup & real-data gate**.
3. If demo rows exist, use **Clear demo data** first.
4. Click **Enable real data for testing**, enter a reason (12+ characters), and confirm.
5. The dashboard should show the red TEST MODE banner and a `TEST` stat.

To use a different directory:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\start-test-mode.ps1 -DataDir D:\agm-test
```

Manual equivalent:

```powershell
$env:AGM_DATA_DIR = "$env:TEMP\agent-mark-test-real"
$env:AGM_TEST_ALLOW_REAL_DATA = "1"
.\hub-desktop\src-tauri\target\debug\agent-mark-hub.exe
```

## Automated smoke tests

With a throwaway data directory and `AGM_TEST_ALLOW_REAL_DATA=1` on the debug build:

```powershell
python hub-desktop\tools\test_override_smoke.py 9230
python hub-desktop\tools\test_override_ui_smoke.py 9234
```

`test_override_smoke.py` proves the normal gate still blocks, a short reason is rejected, the
override is audited, and the dashboard reports `test_override=true`. It also creates and verifies a
backup so the offline verifier has a signed manifest to check. `test_override_ui_smoke.py` drives
the setup form, opens the test panel, and confirms the TEST DATA badge, red banner, and dashboard
stat.

To prove a normal release build ignores the override even when the environment variable is set:

```powershell
# Start target\release\agent-mark-hub.exe with AGM_TEST_ALLOW_REAL_DATA=1 and a clean data dir,
# then:
python hub-desktop\tools\test_override_smoke.py 9235 --expect-blocked
```

It must end with `RESULT: PASS`, `override_available=false`, and `data_mode=demo`.

## Verify the audit trail

Open **Audit** in the app, or run the offline verifier against the test data directory. The verifier
expects at least one backup; use **1. Backup now** then **2. Verify latest** in the app first, or run
the automated smoke above.

```powershell
python hub-desktop\tools\verify_db.py "$env:TEMP\agent-mark-test-real" --user admin --password "your-test-password"
```

The audit chain should include `real_mode.test_override`. The verifier must still end with
`RESULT: PASS`.

## Safety rules

- Use a **separate data directory**. Never point `AGM_DATA_DIR` at the school's live data directory.
- Use synthetic data by default. Real student data may be used only when the school has given
  **written authorization** for this test, access is limited to named staff, the data stays in a
  dedicated test directory, and a deletion date is recorded. Do not copy the school's live database
  into the test directory.
- Do not distribute the debug binary or a `allow-real-data-test` build as a school installer.
- Do not enable the override on a shared staffroom PC that also holds the production database.
- When finished, close the app and delete the test data directory (including its `backups` folder)
  so the test PII does not linger.
- If real PII was used for testing, record the authorization, scope and deletion in the school's
  processing/incident log, and delete it on the agreed schedule.

## What this does not change

- Release installers still enforce the production gate. Setting `AGM_TEST_ALLOW_REAL_DATA=1` on a
  normal release build has no effect.
- The public website/`version.json` still says real student data is not allowed for production use.
- The independent security review, school/legal pack, Windows signing and Android release keystore
  are still required before live use.
- The mobile PWA has its own passcode/privacy/demo-clear gate; this desktop override does not change
  the phone app.
