# External Gates Playbook — Certificate, Independent Review, School/Legal Sign-off

**Status:** operational checklist, not legal advice.
**Use with:** `docs/REAL_DATA_READINESS.md`, `docs/pilot-pack/`, and `Agent_Mark_AUDITOR_SOW.md`.
**Rule:** real student PII stays blocked until all three gates are green and the go/no-go checklist is
signed.

The three gates are independent:

- A code-signing certificate proves **who published the installer** and that it was not modified.
- An independent review gives a **technical opinion** on the local-data design and implementation.
- School/legal sign-off gives the school **authority and a lawful basis** to process real data.

None of them replaces the other two.

---

## 1. Run the workstreams in parallel

| Workstream | Owner | First action | Output | Typical elapsed time |
|---|---|---|---|---|
| OV code-signing certificate | Release owner / Agent Mark lead | Decide the exact legal publisher and order the certificate | Token/HSM + certificate thumbprint; signed installers | 1–3 weeks after complete documents |
| Independent security review | Agent Mark lead + school procurement | Send the SOW to 3 independent reviewers | Findings register, opinion letter, re-test note | 4–8 weeks including remediation |
| School/legal pack | School Head/Proprietor + DPO/counsel + IT lead | Hold a scoping meeting and assign each template | Signed authorization, DPIA, notices, DPA, schedules | 2–6 weeks, mostly school time |

Start all three now. The certificate and reviewer scheduling are usually the critical path.

---

## 2. OV code-signing certificate

### 2.1 Decide the publisher identity first

The certificate subject must match the publisher users see. In this repo, that is
`bundle.publisher` in `hub-desktop/src-tauri/tauri.conf.json` (currently `"Agent Mark"`).

Decide one of these before ordering:

- A registered legal entity (recommended). Use the exact CAC-registered name and registered address.
- An individual/sole proprietor, if the CA supports individual validation.
- The school as publisher, only if the school agrees to own the software publisher identity.

Do not use a trading name that cannot be validated. If the legal name differs from `"Agent Mark"`,
update `tauri.conf.json` before the signed build. Keep the website, installer, and certificate
publisher consistent.

### 2.2 Choose OV, a CA, and key storage

Request an **OV code-signing certificate**. EV is not required for the first pilot and does not
replace the security review.

Ask each CA in writing:

- Do you validate Nigerian organizations/individuals, and which documents do you require?
- Is the private key on a FIPS 140-2 Level 2 / Common Criteria EAL4+ hardware token or HSM?
- Can `signtool` use the certificate from the Windows certificate store, or is signing cloud-only?
- What is the validation time after all documents are complete?
- What is the renewal, replacement, and revocation process if the token is lost?

The current scripts support:

- `AGM_SIGN_THUMBPRINT` — a certificate installed in the Windows certificate store. This is the
  preferred path for a USB hardware token.
- `AGM_SIGN_PFX` + `AGM_SIGN_PASSWORD` — a PFX file. Use this only with a controlled HSM/token
  workflow; do not leave a production private key as a plain PFX on a normal PC.

If the CA offers **cloud signing only**, the current script needs a small adapter. Do not buy a
cloud-only product before confirming how `signtool` will call it.

### 2.3 Order and pass validation

Prepare:

- CAC certificate or business registration.
- Proof of registered address (utility bill, bank statement, or official letter).
- Government ID and phone number for the authorized contact.
- An authorization letter if the signer is not the registered owner.
- A working email/domain and, if requested, a callback number.

The CA may call the published phone number and verify the address. Validation is usually 1–5 business
days after a complete application, but can take longer. Budget for the certificate, token shipping,
and renewal. Prices vary by CA and term; get at least two quotes.

### 2.4 Install, sign, and verify

On the release PC:

1. Install the token middleware and the certificate in `Cert:\CurrentUser\My`.
2. Confirm the thumbprint and that the private key is present.
3. Set the thumbprint and build a signed internal candidate:

```powershell
$env:AGM_SIGN_THUMBPRINT = "<SHA-1 thumbprint>"
$env:AGM_SIGN_TIMESTAMP_URL = "http://timestamp.digicert.com"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 `
  -OutDir pilot-dist-signed `
  -Notes "Signed pilot candidate; not published until review and school sign-off."
```

`-OutDir` keeps the signed bytes out of `website/downloads` and does not update
`website/version.json`. Add `pilot-dist-signed/` to `.gitignore` or keep it outside the repo.

4. Verify every artifact on a clean PC:

```powershell
signtool verify /pa /v .\pilot-dist-signed\Agent-Mark-Hub-0.2.0-x64-setup.exe
signtool verify /pa /v .\pilot-dist-signed\Agent-Mark-Hub-0.2.0-x64.msi
Get-FileHash .\pilot-dist-signed\* -Algorithm SHA256
```

5. Confirm the signature shows the expected publisher and a timestamp. Test install, launch,
   backup, restore, and uninstall on a clean PC.
6. Keep the token and PIN separate. Record the certificate thumbprint, expiry date, release owner,
   and replacement procedure in the pilot evidence file.
7. Revoke and replace the certificate immediately if the token or PIN is lost.

OV signatures do not guarantee that SmartScreen will never warn. Reputation builds over time. Do not
promise users a warning-free install.

### 2.5 Publish and renew

Publish only after the independent review and school/legal gates are green. For the public release,
use the default output so `release.ps1` updates `website/downloads` and `website/version.json`:

```powershell
$env:AGM_SIGN_THUMBPRINT = "<SHA-1 thumbprint>"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\release.ps1 `
  -Notes "Signed pilot release; review and school sign-off complete."
```

Record the signed hashes in `pilot-dist/SHA256SUMS.txt` or the release manifest. Code-signing
certificates are short-lived; timestamp every build and plan renewal before expiry. A timestamp keeps
an existing signature verifiable after the certificate expires, but new builds need a valid
certificate.

---

## 3. Independent security review

### 3.1 Prepare the review bundle

Freeze the code and tag the commit under review. Provide:

- `Agent_Mark_AUDITOR_SOW.md` as the scope and acceptance document.
- Source tree, build scripts, lockfiles, and the exact git commit/tag.
- Unsigned or signed artifacts plus SHA-256 hashes.
- Test evidence: Rust suite, E2E, UI, lifecycle, recovery, release-gate, verifier output.
- Architecture/data-flow notes, threat model, runbook, and pilot pack.
- Synthetic demo data and the `.agmm` fixture. **No real PII.**
- A reference Windows PC and a low-end Android device if requested.

Do not send production data, staff passwords, recovery codes, or the signing token.

### 3.2 Select an independent reviewer

Send the SOW to at least three candidates. Look for:

- Applied crypto, Windows desktop, Android/local-storage, and local-first privacy experience.
- Education/children's-data and NDPA context, or a partner who can cover it.
- A sample redacted report and references.
- Independence from the people who wrote the code; no conflict of interest.
- A fixed fee that includes re-test, an NDA that permits the public summary, and professional
  liability/insurance if available.

Avoid a general IT support shop that cannot show adversarial testing or crypto review work. Do not
make payment contingent on a “pass.”

### 3.3 Kickoff and evidence

Hold an architecture walkthrough and threat-model workshop. Agree:

- Exact scope: desktop hub + mobile local-data path only.
- Out of scope: relay/cloud sync, phone pairing, iOS, features not shipped.
- Test environments, devices, and the restore/theft simulations.
- Finding severity definitions and the remediation/re-test window.
- Who receives the findings and who approves the public summary.

The reviewer should test the actual signed bytes where possible. If the certificate is not ready,
review the source and unsigned artifacts first, then re-test the signed final build and record its
hashes.

### 3.4 Findings and acceptance

- Critical/High findings must be closed and re-tested before real PII.
- Medium/Low findings need an owner, a date, and written acceptance by the Head/DPO if they remain.
- Keep a findings register and a remediation log; do not silently downgrade severity.
- Obtain the signed opinion letter, threat-model review note, re-test note, and approved public
  summary.
- The final opinion must identify the reviewed commit and artifact hashes.

Typical timeline: 2–3 weeks review, 1–2 weeks remediation, 1 week re-test. A narrow scope keeps the
cost down, but do not skip the adversarial tests in the SOW.

---

## 4. School/legal sign-off

This section is operational guidance for the school's counsel/DPO, not legal advice. The school makes
the legal decisions.

### 4.1 Confirm roles and authority

- The **school** is normally the data controller.
- Agent Mark is normally a supplier/processor with **no access** to the local data.
- Confirm who can sign for the school: Head/Proprietor/Board, DPO or privacy counsel, IT lead, and
  the pilot owner. For a public school, confirm whether Ministry/agency approval is also required.
- Record the named pilot cohort, classes, term, staff accounts, device, and backup custodians.

### 4.2 Complete the DPIA

Use `docs/pilot-pack/02_DPIA_TEMPLATE.md`. Under the NDPA 2023, a DPIA is required where processing
is likely to result in high risk; children's data is a high-risk context. The DPIA should record:

- Necessity and proportionality: why the data is needed, why local-only, data minimisation.
- Data categories, data subjects, recipients, retention, and deletion.
- Risks: stolen PC, stolen backup, shared staffroom, insider misuse, mobile loss, report tampering,
  over-retention, support exposure, power loss.
- Mitigations and residual risk: encryption, roles, approval separation, audit chain, backups,
  drills, device hardening, training, incident response.
- Whether any high residual risk requires prior consultation with the Nigeria Data Protection
  Commission (NDPC). Counsel/DPO decides.

### 4.3 Issue notices and confirm the lawful basis

Use `03_PRIVACY_NOTICE_TEMPLATE.md` for staff and parents/guardians, with an age-appropriate student
notice if needed. Counsel/DPO should confirm the lawful basis. Do not assume blanket parental consent
is the only option; a school's public task or legal obligation may be relevant. Record the decision.

The notice should cover:

- What data is collected and why.
- Who can access it and where it is stored.
- That there is no cloud relay, sale, or telemetry in this release.
- Retention and deletion.
- Rights: access, correction, export, erasure where applicable, complaint.
- School contact and the NDPC complaint route.
- Any consequences of not providing required data.

### 4.4 Complete and sign the pilot pack

Assign an owner and a date to each file in `docs/pilot-pack/`:

- `01_SCHOOL_AUTHORIZATION_TEMPLATE.md` — named scope, access, custody, retention.
- `02_DPIA_TEMPLATE.md` — risks, mitigations, residual risk.
- `03_PRIVACY_NOTICE_TEMPLATE.md` — staff/parent/student notice.
- `04_RETENTION_AND_BACKUP_SCHEDULE.md` — retention, backup cadence, pruning, erasure.
- `05_INCIDENT_RESPONSE_TEMPLATE.md` — containment, assessment, notification decision.
- `06_DATA_SUBJECT_REQUEST_PROCEDURE.md` — access, correction, export, erasure.
- `07_STAFF_TRAINING_AND_DEVICE_CHECKLIST.md` — training and device hardening.
- `08_DPA_LOCAL_ONLY_STATEMENT.md` — controller/supplier roles and support boundary.
- `00_PILOT_SIGNOFF_CHECKLIST.md` — final evidence and GO/NO-GO record.

Do not sign blank templates or copy another school's DPIA without adapting it.

### 4.5 Confirm operational readiness

The school should verify, not just document:

- Named staff accounts, no shared login, least-privilege roles.
- BitLocker enabled and recovery key escrowed; standard user for daily work.
- Windows updates, antivirus/EDR, screen lock, physical security.
- Primary and secondary backup locations, named custodian, restore drill completed.
- Recovery code printed, sealed, stored off the PC.
- Retention and deletion dates recorded; backup destruction included.
- Incident contacts and the 72-hour NDPC breach-notification path under NDPA section 40 (counsel
  confirms when notification is required).
- Data-subject request procedure and response times.
- Staff training completed, including passphrase custody, phishing, locking the app, report approval,
  and no personal phones for real data.
- Support boundary: Agent Mark receives no PII by default; any remote support is authorized and
  observed, and tickets contain no student data.
- Rollback owner and previous installer retained.

### 4.6 Hold the go/no-go meeting

Use `00_PILOT_SIGNOFF_CHECKLIST.md`. Record:

- Technical evidence and artifact hashes.
- Certificate/signature verification.
- Reviewer opinion and closed findings.
- Signed school/legal pack.
- Open conditions, owners, and dates.
- GO/NO-GO decision and the real-data start date.

Start with a synthetic shadow run, then a small real-data cohort. Review weekly and keep the rollback
plan ready.

---

## 5. Suggested combined timeline

| Week | Certificate | Independent review | School/legal |
|---|---|---|---|
| 0 | Decide legal publisher; get quotes; order | Send SOW to 3 reviewers | Scoping meeting; assign pack owners |
| 1 | Submit documents; answer CA calls | Select reviewer; sign NDA/SOW | Draft DPIA and notices |
| 2 | Receive token/certificate; test signing | Architecture walkthrough; review starts | DPO/counsel review; IT checks devices |
| 3 | Build signed pilot candidate; verify on clean PC | Code/adversarial testing | Finalise authorization, DPA, retention, incident |
| 4 | Re-sign after fixes if needed | Findings delivered; remediation starts | Issue notices; train staff; run drill |
| 5 | Final signed hashes | Re-test closed findings | Complete sign-off checklist |
| 6 | Publish only after sign-off | Opinion letter and public summary | GO/NO-GO meeting; synthetic shadow run |

Actual dates depend on CA validation, reviewer availability, and school counsel. Do not compress the
review or skip the re-test to hit a date.

---

## 6. Evidence file

Keep one controlled folder (no PII) with:

- Certificate thumbprint, expiry, token custodian, and signed artifact hashes.
- `signtool verify` output and clean-PC install/upgrade/uninstall evidence.
- Reviewer SOW, independence declaration, findings register, closure evidence, opinion letter, and
  re-test note.
- Signed school pack, DPIA, notices, DPA/local-only statement, retention schedule, incident contacts,
  training records, and drill artifact.
- Go/no-go minutes, conditions, real-data start date, and rollback owner.

Store it in the school's controlled evidence location, not in a public repo if it contains school
names or contacts.

---

## 7. What not to do

- Do not treat a code-signing certificate as a security audit.
- Do not let the developer review their own code and call it independent.
- Do not sign blank school templates or use another school's DPIA unchanged.
- Do not put real PII in the reviewer bundle, support tickets, screenshots, or chat.
- Do not publish signed artifacts before the reviewer and school sign off.
- Do not buy a cloud-only signing service without adapting the release script.
- Do not leave a production PFX private key on a normal PC.
- Do not load real data until the signed checklist says GO.
