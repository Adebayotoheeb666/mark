# Volunteer School Pilot — Quickstart & Operator Runbook

**Target Audience:** School Head / Principal, Hub Administrator (Exams/IT Officer), and Subject Teachers  
**Version:** Agent Mark Hub `v0.2.0` (Pilot Release)  
**System Requirements:** Windows 10 or 11 (64-bit), 4 GB RAM minimum, ~150 MB disk space. No internet required after install.

---

## Part 1: Installation & First-Time Setup (Hub Admin)

### Step 1.1: Verify the Downloaded Installer
Verify the file checksum against `SHA256SUMS.txt` using PowerShell:
```powershell
Get-FileHash .\Agent-Mark-Hub-0.2.0-x64-setup.exe -Algorithm SHA256
```
**Expected SHA-256:** `3091FA8054B959778B889410A9E455E080C2D12D8B70E3B7BE92F911493C8210`

*(If using the Portable ZIP, verify `9DFCFCBB34E1B39C34A5C58BF5EB3860C75585C0B6E1314097B7EC94C3FA3DEC`)*

### Step 1.2: Install the Application
1. Double-click `Agent-Mark-Hub-0.2.0-x64-setup.exe`.
2. **Windows SmartScreen Alert:** Because this is an unsigned pilot build, Windows Defender SmartScreen will pop up with:
   > *"Windows protected your PC"*  
   > *"Microsoft Defender SmartScreen prevented an unrecognized app from starting."*
3. Click **"More info"**, then click **"Run anyway"**.
4. The installer completes silently without requiring administrator rights and adds a shortcut to the Windows Start Menu.

*(Alternative: If running from the Portable ZIP, extract the folder to `C:\AgentMark\` or a dedicated directory, keeping `agent-mark-hub.exe` and `WebView2Loader.dll` in the same directory, and double-click `agent-mark-hub.exe`.)*

### Step 1.3: First Launch & Master Recovery Code Custody
1. Launch **Agent Mark Hub**.
2. On first launch, the setup screen prompts for:
   * **School Name** (e.g. `Command Children School`)
   * **Admin Username** (e.g. `admin.exams`)
   * **Admin Password** (must be at least 12 characters, including upper/lower/numbers/symbols).
3. Click **Create Administrator Account**.
4. **CRITICAL STEP:** The screen will display the **Master Recovery Code** (a 24-word or hex emergency phrase).
   * **Immediately write down or print this phrase.**
   * Seal it in a physical envelope.
   * Deposit it in the Principal's locked safe.
   * **Never** save it as a text file on the computer desktop or take a photo of it.
5. Click **I have recorded the recovery code securely** to proceed to the Dashboard.

---

## Part 2: Unlocking REAL DATA MODE (The In-App Gate)

The Hub starts in **DEMO MODE** loaded with 6 synthetic practice students. To enter real student records, complete the 6-step in-app technical sequence:

```
[0. Clear Demo Data] ➔ [1. Backup Now] ➔ [2. Verify Latest] ➔ [3. Run Restore Drill] ➔ [4. Acknowledge Privacy] ➔ [5. Enable Real Data]
```

1. Click on **Backup & Real-Data Gate** in the top navigation bar.
2. Confirm the banner reads `REAL-DATA GATE — complete these steps before importing real students.`
3. Follow the numbered action buttons in exact sequence:
   * **Button 0: "Clear demo data"**  
     Click and confirm twice. This wipes all synthetic sample students and scores, leaving a clean database.
   * **Button 1: "Backup now"**  
     Click to take a full encrypted snapshot (`AGMBK001`) of the clean database.
   * **Button 2: "Verify latest"**  
     Click to test the cryptographic hash chain and AEAD cipher of the snapshot. (Toast will show: *Verified: 0 students, 0 scores, audit chain OK*).
   * **Button 3: "Run restore drill"**  
     Click to simulate an emergency restore in an isolated scratch memory database. (Toast will confirm the drill passed).
   * **Button 4: "Acknowledge privacy notice"**  
     Click to confirm that the school operates under local-only privacy rules with no vendor data sharing.
   * **Button 5: "Enable real data"**  
     This button now activates! Click it and confirm.
4. **Success:** The top header badge turns green and displays **REAL DATA MODE**. The system is now permanently unlocked for real student records.

---

## Part 3: User Accounts & Role Separation

Under **Users**, create dedicated individual accounts for each staff member. Never share login credentials!

| Role | Permitted Actions | Staff Member |
| :--- | :--- | :--- |
| **Admin** | Manages accounts, roster CSV import, backups, restore drills, system purge. *Cannot approve or lock reports.* | Exams Officer / IT Lead |
| **Head** | Reviews teacher submissions, gives final approval, locks and cryptographically signs report cards. *Cannot edit raw marks.* | School Principal / Head Teacher |
| **Teacher** | Enters subject scores, submits corrections with required audit reasons, enters teacher comments, approves drafts for review. | Subject / Form Teachers |
| **Viewer** | Read-only inspection of reports, rosters, and audit logs. | Board / External Auditor |

---

## Part 4: Roster Import & Daily Workflow

### Step 4.1: Preparing the Student Roster CSV
Prepare an Excel sheet and export as `.csv` with these exact column headers:
```csv
short_code,first_name,last_name,class_label
STD001,Ibrahim,Balogun,JSS1-A
STD002,Chidinma,Eze,JSS1-A
STD003,Oluwaseun,Adeyemi,JSS1-B
```
* **Rules:**
  * `short_code` must be unique per student (e.g. student registration number).
  * No weird symbols; quotes around names with commas are supported.

### Step 4.2: Importing into the Hub (Admin)
1. Go to **Students** ➔ **Import Roster**.
2. Paste the CSV content or select the file.
3. Click **Dry Run** first: The Hub parses every row, checks for duplicates, and confirms validation rules without touching the database.
4. If the dry run is clean (0 errors), click **Confirm & Import**.

### Step 4.3: Entering Marks & Corrections (Teachers)
1. Log in as a **Teacher**.
2. Go to **Scores** ➔ Select the Class and Subject (e.g. `JSS1-A`, `Mathematics`).
3. Enter Continuous Assessment (CA) and Examination marks.
4. **Making a Correction:** If a mark was entered incorrectly, click **Correct**. The system requires an **audit reason of at least 8 characters** (e.g., *"Remarking script per exam committee"*). The system stores both versions immutably in the audit log.

### Step 4.4: Teacher Comments & First Review (Teacher)
1. Go to **Reports** ➔ Click **Generate Drafts** for the term (e.g. `1T-26`).
2. Select a student ➔ Add appropriate behavioral/academic comments.
3. Once satisfied, click **Approve Draft**. The status changes from `DRAFT` to `REVIEWED`.

### Step 4.5: Final Head Approval & Signing (School Head)
1. Log in as the **School Head**.
2. Go to **Reports** ➔ Filter by `REVIEWED`.
3. Inspect the marks, calculations, and comments.
4. Click **Approve (Head Review)**.
5. Click **Lock & Sign Report**.
   * The Hub computes an SHA-256 digest of the entire report card payload and signs it with the school's local private Ed25519 key.
   * The resulting signature string (`AGM1:<report-id>:<sha256>:<signature>`) is embedded directly into the report card footer.
6. Click **Print / Preview** to print standard A4 report cards for parents.

---

## Part 5: Daily Backup & Safety Discipline

### The 3-Minute Daily Routine (Exams Officer):
1. At the end of each day of mark entry, log in as **Admin**.
2. Go to **Backup & Real-Data Gate** ➔ Click **Backup now**.
3. Plug in a dedicated school USB flash drive.
4. Copy the newly generated backup kit from:
   `%APPDATA%\org.agentmark.hub\agent-mark-hub\backups\`
   *(Each kit contains: `backup-<timestamp>.agm`, `manifest-<timestamp>.json`, and `vault-BK-<timestamp>.json`)*
5. Store the USB drive in a secure drawer away from the computer.

### Emergency Disaster Recovery (New PC):
If the school desktop hard drive crashes or the PC is damaged:
1. Install Agent Mark Hub on a replacement Windows PC.
2. Insert your backup USB flash drive.
3. Launch the Hub. Instead of creating a new school, click **Recover from Backup**.
4. Select the backup folder on your USB drive and enter your original Admin password.
5. The entire school database, student roster, marks, audit history, and signing keys are fully restored within seconds!
