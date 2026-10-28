# Volunteer School Pilot Authorization & Risk Acceptance Agreement

**Agreement Version:** 1.0 (Pilot Candidate Build `v0.2.0`)  
**Applicable Legal Framework:** Nigeria Data Protection Act 2023 (NDPA) / Applicable Education Law  
**Status:** Authorized Single-School Controlled Pilot

---

## 1. Parties and Contact Information

### 1.1 The School (Data Controller)
* **Official School Name:** __________________________________________________
* **School Physical Address:** ______________________________________________
* **Pilot Owner / Head of School:** __________________________________________
* **Designated Hub Administrator (IT / Exams):** _____________________________
* **Contact Phone / Email:** _________________________________________________

### 1.2 Software Developer (Supplier / Technology Provider)
* **Provider:** Agent Mark Project
* **Technical Lead / Representative:** _______________________________________
* **Contact Phone / Email:** _________________________________________________

---

## 2. Pilot Scope and Purpose

The School hereby authorizes a controlled, single-school pilot deployment of **Agent Mark Hub (v0.2.0)** for the purpose of managing student class rosters, continuous assessment marks, exam grades, and generating cryptographically signed term report cards.

### 2.1 Scope Parameters
* **Target Hardware:** Exactly one (1) designated, school-owned Windows 10/11 desktop PC located in a secure school office / staffroom.
* **Target Cohort:** 
  * Academic Term / Session: _____________________________________________
  * Classes / Arms included in pilot: _____________________________________
  * Approximate number of students: _____________________________________
* **System Boundaries:**
  * The software operates **strictly locally** on the designated PC.
  * **No Cloud Relay:** No cloud synchronization, no centralized database, and no vendor-side telemetry exist. Student data never transmits over the internet.
  * **Mobile Companion (Optional):** If teachers capture marks on mobile phones, data is stored in an encrypted local browser store (passcode-protected AES-256-GCM) and transferred **manually** to the Hub PC via an encrypted `.agmm` export file. No cloud pairing is permitted.

---

## 3. Explicit Acknowledgement of Pilot Blockers & Risk Acceptance

The School, through its Head / Principal and Hub Administrator, acknowledges that this deployment is an authorized **pilot test** and explicitly accepts the following operational and technical conditions:

1. **Unsigned Windows Installer Acceptance:**
   * The Windows installers (`Agent-Mark-Hub-0.2.0-x64-setup.exe` and `Agent-Mark-Hub-0.2.0-x64.msi`) are currently **unsigned** because an organizational Code-Signing Certificate (OV/EV) has not yet been acquired.
   * On initial installation, Windows Defender SmartScreen will display an *"Unknown Publisher / Windows protected your PC"* prompt. The School explicitly authorizes bypassing this warning via *"More info" → "Run anyway"*.
   * To ensure the binary has not been tampered with in transit, the School IT Admin agrees to verify the file hash against the official `SHA256SUMS.txt` manifest prior to execution.

2. **Internal Engineering Verification Status (Independent Review Pending):**
   * The School understands that while Agent Mark Hub has passed 100% of internal automated test suites (17 Rust native tests, 47 Python reference tests, end-to-end disaster recovery drill simulations, and cryptographic tamper-rejection tests), a formal third-party commercial cybersecurity audit has not yet been executed.
   * The School accepts the internal cryptographic architecture:
     * Whole-database encryption at rest using **XChaCha20-Poly1305 AEAD**.
     * Password derivation and master key wrapping using **Argon2id**.
     * Tamper-evident report card signatures using **Ed25519**.
     * Append-only cryptographic hash chaining for all audit log entries.

3. **Data Controller Responsibility under NDPA 2023:**
   * The School confirms it acts as the sole **Data Controller** under Section 65 of the Nigeria Data Protection Act 2023.
   * Agent Mark holds **no access** to live student records, holds no copy of the encryption keys, and has no remote backdoor or administrative access to the school database.
   * The School has verified its lawful basis for processing student educational records under NDPA Section 25 and school enrollment policies.

---

## 4. Custody and Security Obligations

### 4.1 Master Recovery Code Custody
* During initial setup, the Hub displays a printed Master Recovery Code.
* **Obligation:** The Hub Admin and School Head must immediately print or write down this recovery code and seal it in a physical envelope stored in the School Safe or Principal's locked file. 
* **Prohibition:** The recovery code must **never** be stored in a plaintext file on the PC, uploaded to cloud storage, or photographed on an unsecured personal mobile phone.

### 4.2 Local Device Hardening
The School agrees to enforce the following physical and system safeguards on the pilot PC:
1. **Windows User Accounts:** Daily work is conducted under a standard Windows user account. Individual staff accounts are created inside the Hub (Admin, Head, Teacher, Viewer). Shared login accounts are prohibited.
2. **Idle Lockout:** The Hub locks automatically after 15 minutes of inactivity; staff must manually lock Windows when leaving the desk.
3. **BitLocker / Full Disk Encryption:** Enabled on the primary drive with the recovery key escrowed by School IT.
4. **Antivirus & OS Updates:** Running active Windows Defender / Antivirus with current security updates.

### 4.3 Backup & Disaster Recovery Discipline
* Backups created by the Hub are full snapshots (`AGMBK001`) encrypted with the school's master key.
* The Hub Administrator agrees to create a backup after significant data entry or at least weekly.
* At least one copy of each verified backup kit (the `.agm` encrypted database, `.json` manifest, and `vault-BK-*.json` key wrapper) must be copied to a dedicated external USB flash drive stored away from the PC.

---

## 5. Pilot Stop Conditions & Rollback

The School reserves the right to terminate or pause the pilot at any time upon notice to the developer.

### Stop Conditions:
* Any unexplained data corruption, unverified backup error, or restore drill failure.
* A suspected physical theft or unauthorized extraction of the PC or backup media.
* Any operational directive from school management or education regulators.

### Offboarding / Erasure:
Upon completion or termination of the pilot, the Hub Admin can permanently wipe all live records via the Hub's double-confirmed **"Purge all live data"** command, which zeroes all student records, marks, and draft reports while retaining the cryptographic audit log.

---

## 6. Execution and Sign-Off

By signing below, the School and the Technology Provider agree to the pilot terms and authorize the installation and activation of Agent Mark Hub `v0.2.0` in **REAL DATA MODE** for the agreed pilot cohort.

### For the School:

________________________________________  
**School Head / Principal (Signature & Date)**  
Name:  
Title:  

________________________________________  
**Hub Administrator / Exams Officer (Signature & Date)**  
Name:  
Title:  

### For the Technology Provider:

________________________________________  
**Agent Mark Representative (Signature & Date)**  
Name:  
Title: Technical Lead  
