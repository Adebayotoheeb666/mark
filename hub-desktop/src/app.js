/* Agent Mark Hub console — Elevated Desktop UI (Pilot Edition)
 * Auth is backend-enforced: the UI never supplies an actor or a role. */

const inv = (...a) => window.__TAURI__.core.invoke(...a);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jsq = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/</g, "\\x3c");

let SEC = "dash";
let SESSION = null;
let DASH = null;
let PENDING_RECOVERY = "";
let idleTimer = null;

/* ---------------- Toast Notification ---------------- */
function toast(msg, bad) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = String(msg);
  t.style.display = "flex";
  t.style.alignItems = "center";
  t.style.gap = "8px";
  t.style.background = bad ? "#be123c" : "#064e3b";
  t.style.border = bad ? "1px solid #fecdd3" : "1px solid #a7f3d0";
  clearTimeout(t._h);
  t._h = setTimeout(() => {
    t.style.display = "none";
  }, 5200);
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------------- In-App Modal Dialog System ---------------- */
function closeModal() {
  const c = $("#modal-container");
  if (c) c.innerHTML = "";
}

function showModalDialog({ title, bodyHtml, confirmText = "Confirm", cancelText = "Cancel", isDanger = false, onConfirm }) {
  const c = $("#modal-container");
  if (!c) {
    if (confirm(`${title}\n\n${bodyHtml.replace(/<[^>]+>/g, "")}`)) {
      if (onConfirm) onConfirm();
    }
    return;
  }
  c.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-dialog">
        <div class="modal-header">
          <h3>${esc(title)}</h3>
        </div>
        <div class="modal-body">
          ${bodyHtml}
        </div>
        <div class="modal-footer">
          <button class="act ghost" type="button" id="modal-cancel-btn">${esc(cancelText)}</button>
          <button class="act ${isDanger ? "danger" : ""}" type="button" id="modal-confirm-btn">${esc(confirmText)}</button>
        </div>
      </div>
    </div>
  `;
  const cancelBtn = $("#modal-cancel-btn");
  const confirmBtn = $("#modal-confirm-btn");
  const overlay = $("#modal-overlay");

  cancelBtn.onclick = () => closeModal();
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };
  confirmBtn.onclick = async () => {
    confirmBtn.disabled = true;
    try {
      if (onConfirm) await onConfirm();
      closeModal();
    } catch (e) {
      toast(e, true);
      confirmBtn.disabled = false;
    }
  };
  confirmBtn.focus();
}

function promptModal({ title, message, defaultValue = "", placeholder = "", confirmText = "Save", onConfirm }) {
  const inputId = "prompt-modal-input";
  const bodyHtml = `
    <p>${esc(message)}</p>
    <input id="${inputId}" class="wide-input" value="${esc(defaultValue)}" placeholder="${esc(placeholder)}" autocomplete="off">
  `;
  showModalDialog({
    title,
    bodyHtml,
    confirmText,
    onConfirm: async () => {
      const val = $(`#${inputId}`)?.value;
      if (onConfirm) await onConfirm(val);
    },
  });
  setTimeout(() => {
    const el = $(`#${inputId}`);
    if (el) {
      el.focus();
      el.select();
      el.onkeydown = (e) => {
        if (e.key === "Enter") $("#modal-confirm-btn")?.click();
        if (e.key === "Escape") closeModal();
      };
    }
  }, 50);
}

function confirmModal({ title, message, confirmText = "Confirm", isDanger = false, onConfirm }) {
  showModalDialog({
    title,
    bodyHtml: `<p>${esc(message)}</p>`,
    confirmText,
    isDanger,
    onConfirm,
  });
}

/* ---------------- Tauri IPC Invocation ---------------- */
async function call(fn, args, okMsg) {
  try {
    const r = await inv(fn, args || {});
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    const m = String(e);
    if (/Sign in required|Session locked/i.test(m)) {
      SESSION = null;
      DASH = null;
      showLogin("Please sign in again.");
    } else if (/Change your temporary password/i.test(m)) {
      showChangePassword();
    }
    toast(m, true);
    return null;
  }
}

function setAuth(html) {
  document.body.classList.add("auth-mode");
  $("#auth").innerHTML = html;
}

function roleLabel(r) {
  return ({ admin: "Admin", head: "Head Reviewer", teacher: "Teacher", viewer: "Auditor / Viewer" })[r] || r;
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (document.body.classList.contains("auth-mode") || !SESSION) return;
  idleTimer = setTimeout(() => lockApp(), 15 * 60 * 1000);
}

async function boot() {
  try {
    const st = await inv("vault_status");
    if (!st.initialized) return showSetup();
    if (!st.unlocked) return showLogin();
    SESSION = st;
    if (st.must_change) return showChangePassword();
    showApp();
  } catch (e) {
    setAuth(`<div class="auth-card">
      <div class="brand">Vault Error</div>
      <h2>Agent Mark Hub</h2>
      <p class="blocking">${esc(e)}</p>
      <p class="muted">If this persists, restore <code>vault.json</code> from the school backup kit.</p>
    </div>`);
  }
}

/* ---------------- Auth Screens ---------------- */
function showSetup() {
  setAuth(`<div class="auth-card">
    <div class="brand">Initial Setup · School Deployment</div>
    <h2>Set up this school PC</h2>
    <p class="muted">Creates the local encrypted vault and the initial Hub Administrator account. All student data stays on this PC.</p>
    <form onsubmit="doSetup(event)">
      <label class="field">Official school name
        <input id="su-school" maxlength="80" required placeholder="e.g. Command Children School">
      </label>
      <label class="field">Administrator username
        <input id="su-user" required autocomplete="username" placeholder="e.g. admin.exams">
      </label>
      <label class="field">Administrator password (12+ chars)
        <input id="su-pass" type="password" minlength="12" required autocomplete="new-password" placeholder="Unique strong passphrase">
      </label>
      <label class="field">Confirm password
        <input id="su-confirm" type="password" minlength="12" required autocomplete="new-password" placeholder="Re-type password">
      </label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Create Encrypted Vault</button>
    </form>
    <p class="fine">Air-gapped by design. No cloud synchronization. Zero vendor telemetry.</p>
  </div>`);
}

async function doSetup(e) {
  e.preventDefault();
  const r = await call("setup", {
    schoolName: $("#su-school").value.trim(),
    username: $("#su-user").value.trim(),
    password: $("#su-pass").value,
    confirm: $("#su-confirm").value,
  });
  if (!r) return;
  SESSION = { username: r.username, role: r.role, must_change: false };
  showRecoveryCode(r.recovery_code);
}

function showRecoveryCode(code) {
  PENDING_RECOVERY = code;
  setAuth(`<div class="auth-card">
    <div class="brand" style="color:var(--warn)">Critical Step · Offline Custody</div>
    <h2>Emergency Master Recovery Code</h2>
    <p class="muted">If administrator credentials are forgotten or corrupted, this cryptographic phrase is the only mechanism to unlock the vault. Print or write this down and store it in the Principal's safe.</p>
    <pre class="recovery">${esc(code)}</pre>
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <button class="act ghost" type="button" onclick="copyRecovery()">Copy code</button>
      <button class="act ghost" type="button" onclick="window.print()">Print recovery kit</button>
    </div>
    <label class="check">
      <input id="saved-code" type="checkbox"> I have recorded and sealed this recovery code in an offline secure location.
    </label>
    <button class="act wide" type="button" onclick="finishSetup()">Continue to the hub</button>
  </div>`);
}

async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(PENDING_RECOVERY);
    toast("Recovery code copied to clipboard. Paste, record offline, then clear clipboard.");
  } catch (e) {
    toast("Clipboard copy failed — please write the code down manually.", true);
  }
}

function finishSetup() {
  if (!$("#saved-code") || !$("#saved-code").checked) {
    toast("You must confirm you have saved the recovery code before continuing.", true);
    return;
  }
  PENDING_RECOVERY = "";
  boot();
}

function showLogin(msg) {
  setAuth(`<div class="auth-card">
    <div class="brand">Agent Mark Hub · Secure Login</div>
    <h2>Unlock this Hub</h2>
    <p class="muted">The local database is encrypted with XChaCha20-Poly1305. Sign in with your school account.</p>
    <form onsubmit="doUnlock(event)">
      <label class="field">Username
        <input id="li-user" required autocomplete="username" placeholder="Staff username">
      </label>
      <label class="field">Password
        <input id="li-pass" type="password" required autocomplete="current-password" placeholder="Passphrase">
      </label>
      <div id="auth-err" class="auth-err">${msg ? esc(msg) : ""}</div>
      <button class="act wide" type="submit">Unlock Hub</button>
    </form>
    <p class="fine"><a href="#" onclick="showRecovery();return false;">Forgot password? Use offline recovery code</a></p>
    <p class="fine"><a href="#" onclick="showRecoverFromBackup();return false;">Restore this PC from a backup</a></p>
  </div>`);
}

async function doUnlock(e) {
  e.preventDefault();
  const r = await call("unlock", { username: $("#li-user").value.trim(), password: $("#li-pass").value });
  if (!r) return;
  SESSION = r;
  if (r.must_change) return showChangePassword();
  showApp();
}

function showRecovery() {
  setAuth(`<div class="auth-card">
    <div class="brand">Account Recovery</div>
    <h2>Reset Password with Recovery Code</h2>
    <p class="muted">Enter the 24-word or hex emergency recovery code to set a new administrator passphrase.</p>
    <form onsubmit="doRecovery(event)">
      <label class="field">Username<input id="rc-user" required autocomplete="username"></label>
      <label class="field">Recovery code<input id="rc-code" required autocomplete="off" placeholder="XXXX-XXXX-..."></label>
      <label class="field">New password<input id="rc-pass" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field">Confirm password<input id="rc-confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Reset password</button>
    </form>
    <p class="fine"><a href="#" onclick="showLogin();return false;">Back to sign in</a></p>
  </div>`);
}

async function doRecovery(e) {
  e.preventDefault();
  const r = await call("recovery_reset", {
    username: $("#rc-user").value.trim(),
    recoveryCode: $("#rc-code").value,
    newPassword: $("#rc-pass").value,
    confirm: $("#rc-confirm").value,
  });
  if (r) showLogin("Password reset successfully. Sign in with the new password.");
}

function showRecoverFromBackup() {
  setAuth(`<div class="auth-card">
    <div class="brand">Disaster Recovery</div>
    <h2>Restore this PC from a Backup</h2>
    <p class="muted">Restores live school records when <code>hub.db</code> is missing or corrupted. Ensure your USB backup kit is in the <code>backups</code> folder.</p>
    <form onsubmit="doRecoverFromBackup(event)">
      <label class="field">Username<input id="rb-user" required autocomplete="username"></label>
      <label class="field">Password<input id="rb-pass" type="password" required autocomplete="current-password"></label>
      <label class="field">Backup ID (optional)<input id="rb-id" autocomplete="off" placeholder="Leave blank for newest verified backup"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Verify and restore backup</button>
    </form>
    <p class="fine">The snapshot is verified cryptographically before replacing any live data.</p>
    <p class="fine"><a href="#" onclick="showLogin();return false;">Back to sign in</a></p>
  </div>`);
}

async function doRecoverFromBackup(e) {
  e.preventDefault();
  const r = await call("recover_from_backup", {
    username: $("#rb-user").value.trim(),
    password: $("#rb-pass").value,
    backupId: $("#rb-id").value.trim() || null,
  });
  if (!r) return;
  SESSION = r;
  if (r.must_change) return showChangePassword();
  showApp();
  toast("Backup restored successfully. Run a fresh restore drill before data entry.");
}

function showChangePassword() {
  setAuth(`<div class="auth-card">
    <div class="brand">Security Policy</div>
    <h2>Change Your Password</h2>
    <p class="muted">Your account was assigned a temporary password. Choose a new secure 12+ character passphrase.</p>
    <form onsubmit="doChangePassword(event,false)">
      <label class="field">Current password<input id="cp-old" type="password" required autocomplete="current-password"></label>
      <label class="field">New password<input id="cp-new" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field">Confirm new password<input id="cp-confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Update Password</button>
    </form>
  </div>`);
}

async function doChangePassword(e, inApp) {
  e.preventDefault();
  const p = inApp ? "#ac-" : "#cp-";
  const r = await call("change_password", {
    oldPassword: $(p + "old").value,
    newPassword: $(p + "new").value,
    confirm: $(p + "confirm").value,
  });
  if (!r) return;
  if (inApp) {
    toast("Password updated successfully.");
    render();
  } else {
    SESSION.must_change = false;
    showApp();
  }
}

/* ---------------- App Shell Lifecycle ---------------- */
function showApp() {
  if (!SESSION) return boot();
  document.body.classList.remove("auth-mode");
  $("#auth").innerHTML = "";
  
  const chipName = $("#user-chip .userchip-name");
  if (chipName) {
    chipName.textContent = `${SESSION.username} · ${roleLabel(SESSION.role)}`;
  } else {
    $("#user-chip").textContent = `${SESSION.username} · ${roleLabel(SESSION.role)}`;
  }

  $("#nav-users").style.display = SESSION.role === "admin" ? "" : "none";
  resetIdle();
  render();
}

async function lockApp() {
  await call("lock", {});
  SESSION = null;
  DASH = null;
  showLogin("Hub locked.");
}

function go(s) {
  SEC = s;
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("on", x.dataset.s === s));
  render();
}

function applyHeader(d) {
  $("#school-label").textContent = d.school_name || "School";
  
  const badge = $("#mode-badge");
  if (badge) {
    badge.textContent = d.test_override ? "TEST DATA" : (d.live ? "REAL DATA" : "DEMO");
    badge.className = "pill " + (d.test_override ? "warning" : (d.live ? "live" : "off"));
  }

  const chipName = $("#user-chip .userchip-name");
  if (chipName) {
    chipName.textContent = `${d.username} · ${roleLabel(d.role)}`;
  } else {
    $("#user-chip").textContent = `${d.username} · ${roleLabel(d.role)}`;
  }
}

async function render() {
  if (!SESSION) return boot();
  if (SESSION.must_change) return showChangePassword();
  const v = $("#view");
  v.innerHTML = "<div class='card' style='text-align:center;padding:36px;color:var(--mut);'>Loading console view…</div>";
  try {
    if (!DASH) {
      DASH = await inv("dashboard");
      applyHeader(DASH);
    }
    if (SEC === "dash") v.innerHTML = await dash();
    else if (SEC === "students") v.innerHTML = await students();
    else if (SEC === "scores") v.innerHTML = await scores();
    else if (SEC === "flags") v.innerHTML = await flags();
    else if (SEC === "comments") v.innerHTML = await comments();
    else if (SEC === "reports") v.innerHTML = await reports();
    else if (SEC === "backup") v.innerHTML = await backup();
    else if (SEC === "audit") v.innerHTML = await audit();
    else if (SEC === "users") v.innerHTML = await users();
    else if (SEC === "account") v.innerHTML = await account();
    else v.innerHTML = await dash();

    if (SEC === "scores") { scoreLabels(); corLabels(); }
  } catch (e) {
    v.innerHTML = `<div class='card blocking'>${esc(e)}</div>`;
  }
}

/* ---------------- 1. Dashboard View ---------------- */
async function dash() {
  DASH = await inv("dashboard");
  applyHeader(DASH);
  
  const block = DASH.blocking.map((b) => `<li class="blocking">${esc(b)}</li>`).join("") || "<li class='ok'>All operational checks passing.</li>";
  const warn = DASH.warning.map((b) => `<li class="warning">${esc(b)}</li>`).join("") || "<li>No active warnings.</li>";
  
  const modeBanner = DASH.test_override
    ? `<div class="banner warn"><b>REAL DATA TEST MODE</b> — the production real-data gate was bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.</div>`
    : DASH.live
      ? `<div class="banner real"><b>REAL DATA MODE</b> — Production mode active. Always create a verified backup before bulk changes or term locking.</div>`
      : `<div class="banner demo"><b>PILOT SETUP MODE</b> — Database ready. Complete the Backup & Restore drill gate to enable live student records.</div>`;

  const must = DASH.must_change
    ? `<div class="banner warn">You are using a temporary password. <button class="act ghost" onclick="showChangePassword()">Change password now</button></div>`
    : "";

  const demoCleanupAlert = (DASH.students > 0 && !DASH.live)
    ? `<div class="banner warn" style="justify-content:space-between;">
        <div><b>Demo Records Present:</b> ${DASH.students} demo students exist in the system. Clear them to prepare for real student roster import.</div>
        <button class="act danger" onclick="doClearDemo()">Clear demo data</button>
      </div>`
    : "";

  const schoolForm = SESSION.role === "admin"
    ? `<div class="card">
        <h2>School Identity &amp; Branding</h2>
        <p class="muted small">This school name is printed on official term report cards and embedded into cryptographic Ed25519 signatures.</p>
        <div class="actions">
          <input id="school-name" value="${esc(DASH.school_name)}" maxlength="80" class="grow" placeholder="Enter full official school name">
          <button class="act" onclick="doSchool()">Save name</button>
        </div>
      </div>`
    : "";

  return `
  ${modeBanner}
  ${must}
  ${demoCleanupAlert}

  <div class="grid">
    <div class="stat">
      <b>${DASH.students}</b>
      <span>Enrolled Students</span>
    </div>
    <div class="stat">
      <b>${DASH.scores}</b>
      <span>Scores Recorded</span>
    </div>
    <div class="stat ${DASH.flags_open ? "warn" : "ok"}">
      <b>${DASH.flags_open}</b>
      <span>Open Flags</span>
    </div>
    <div class="stat">
      <b>${DASH.reports_locked}</b>
      <span>Locked Reports</span>
    </div>
    <div class="stat ${DASH.backup_verified ? "ok" : "bad"}">
      <b>${DASH.backup_verified ? "YES" : "NO"}</b>
      <span>Backup Verified</span>
    </div>
    <div class="stat ${DASH.drill_passed ? "ok" : "bad"}">
      <b>${DASH.drill_passed ? "YES" : "NO"}</b>
      <span>Drill Passed</span>
    </div>
    ${DASH.test_override ? `<div class="stat bad"><b>TEST</b><span>Gate Override</span></div>` : ""}
  </div>

  <div class="card">
    <h2>System Readiness &amp; Operational Health</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;">
      <div>
        <h3>Blocking Prerequisites</h3>
        <ul>${block}</ul>
      </div>
      <div>
        <h3>System Warnings</h3>
        <ul>${warn}</ul>
      </div>
    </div>
    <div class="actions" style="margin-top:14px;border-top:1px solid var(--line);padding-top:14px;">
      <button class="act ghost" onclick="go('backup')">Backup &amp; real-data gate</button>
      <button class="act ghost" onclick="go('students')">View Students</button>
      <button class="act ghost" onclick="go('scores')">Open Gradebook</button>
    </div>
  </div>

  ${schoolForm}
  `;
}

async function doSchool() {
  const r = await call("school_set", { name: $("#school-name").value.trim() }, "School name saved.");
  if (r) { DASH = null; render(); }
}

/* ---------------- 2. Students View ---------------- */
async function students() {
  const list = await inv("students");
  const isAdmin = SESSION.role === "admin";
  
  const rows = list.map((s) => `
    <tr>
      <td class="mono"><b>${esc(s.short_code)}</b></td>
      <td>${esc(s.first)} ${esc(s.last)}</td>
      <td><span class="pill off">${esc(s.class)}</span></td>
      <td>
        ${isAdmin ? `
          <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doEditStudent('${jsq(s.short_code)}')">Edit</button>
          <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doExportStudent('${jsq(s.short_code)}')">Export</button>
          <button class="act danger" style="padding:4px 9px;font-size:12px;" onclick="doDeleteStudent('${jsq(s.short_code)}')">Delete</button>
        ` : "—"}
      </td>
    </tr>
  `).join("");

  const canImport = SESSION.role === "admin" && DASH && DASH.live;

  const emptyState = list.length === 0
    ? `<tr><td colspan="4" style="text-align:center;padding:32px;color:var(--mut);">No students enrolled yet. Use the CSV Roster Import tool below to add students.</td></tr>`
    : "";

  return `
  <div class="card">
    <h2>Student Enrolment (${list.length})</h2>
    <table>
      <thead>
        <tr><th>Registration Code</th><th>Full Name</th><th>Class Arm</th><th>Data Actions</th></tr>
      </thead>
      <tbody>
        ${rows || emptyState}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>CSV roster import</h2>
    <p class="muted small">Required format: <code>short_code,first_name,last_name,class_label</code>. Comma-separated values, quotes supported. Perform a dry-run check first to validate schema and check for duplicates.</p>
    <textarea id="csv" rows="5" class="wide-input mono" placeholder="short_code,first_name,last_name,class_label&#10;26-JSS2A-001,John,Okafor,JSS2-A&#10;26-JSS2A-002,Mary,Eze,JSS2-A"></textarea>
    <div class="actions">
      <button class="act ghost" onclick="doImport(true)">Dry-run check</button>
      <button class="act" ${canImport ? "" : "disabled"} onclick="doImport(false)">Import for real</button>
    </div>
    ${canImport ? "" : `<p class="warning small" style="margin-top:8px;">Real import is locked. Complete the Backup Gate and enable REAL DATA MODE first.</p>`}
    <div id="imp" style="margin-top:12px;"></div>
  </div>

  <div class="card">
    <h2>Data lifecycle</h2>
    <p class="muted small">In compliance with Nigeria Data Protection Act 2023 (NDPA), Administrators can edit student identities, export complete data-subject files in JSON, or permanently purge records. All mutations are hash-chained in the audit trail.</p>
  </div>

  <div class="card">
    <h2>Import from phone (.agmm)</h2>
    <p class="muted small">Encrypted transfer file from the mobile companion app. Enter the transfer passphrase created on the mobile device. Real import requires REAL DATA MODE.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
      <input type="file" id="agmm-file" accept=".agmm,application/octet-stream">
      <input id="agmm-pass" type="password" style="min-width:240px;" placeholder="Transfer passphrase (12+ characters)">
    </div>
    <div class="actions">
      <button class="act ghost" onclick="doMobileImport(true)">Dry-run check</button>
      <button class="act" ${canImport ? "" : "disabled"} onclick="doMobileImport(false)">Import from phone</button>
    </div>
    <div id="mimp" style="margin-top:10px;"></div>
  </div>
  `;
}

async function doEditStudent(code) {
  const list = await inv("students");
  const s = list.find((x) => x.short_code === code);
  if (!s) { toast("Student record not found.", true); return; }

  showModalDialog({
    title: `Edit Student: ${code}`,
    bodyHtml: `
      <label class="field">First name<input id="edit-first" value="${esc(s.first)}"></label>
      <label class="field">Last name<input id="edit-last" value="${esc(s.last)}"></label>
      <label class="field">Class arm<input id="edit-class" value="${esc(s.class)}"></label>
    `,
    confirmText: "Save changes",
    onConfirm: async () => {
      const first = $("#edit-first")?.value.trim();
      const last = $("#edit-last")?.value.trim();
      const cls = $("#edit-class")?.value.trim();
      if (!first || !last || !cls) throw "All fields are required.";
      const r = await call("student_update", { shortCode: code, first, last, class: cls }, "Student updated.");
      if (r) { DASH = null; render(); }
    },
  });
}

async function doExportStudent(code) {
  confirmModal({
    title: "Export Student Data Subject File",
    message: `Generate and download a complete JSON export for student ${code}? Store the exported file securely.`,
    confirmText: "Download Export",
    onConfirm: async () => {
      const data = await call("student_export", { shortCode: code });
      if (!data) return;
      downloadText(`student-${code}-export.json`, data, "application/json");
      toast("Data export created successfully.");
    },
  });
}

async function doDeleteStudent(code) {
  promptModal({
    title: `Delete Student: ${code}`,
    message: `Permanently delete student ${code} and all associated grades, comments, flags, and reports? Type the student registration code (${code}) to confirm:`,
    placeholder: code,
    confirmText: "Permanently Delete",
    onConfirm: async (typed) => {
      if (!typed || typed.trim() !== code) {
        toast("Confirmation code did not match. Deletion cancelled.", true);
        return;
      }
      const r = await call("student_delete", { shortCode: code, confirmCode: typed.trim() });
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

async function doImport(dry) {
  if (!dry && (!DASH || !DASH.live)) {
    toast("Real import is locked until REAL DATA MODE is enabled.", true);
    return;
  }
  const r = await call("roster_import", { csvText: $("#csv").value, dryRun: dry });
  if (!r) return;
  $("#imp").innerHTML = `<p>Records processed: <b>${r.would_import}</b></p>` +
    (r.errors.length ? `<ul class="blocking">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "<p class='ok'>✓ Validation check passed with zero errors.</p>");
  if (!dry && !r.errors.length) { DASH = null; render(); }
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").split(",")[1] || "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

async function doMobileImport(dry) {
  const f = $("#agmm-file")?.files[0];
  if (!f) { toast("Select an .agmm file first.", true); return; }
  const pass = $("#agmm-pass")?.value;
  if (!pass) { toast("Enter the transfer passphrase.", true); return; }
  if (!dry && (!DASH || !DASH.live)) {
    toast("Real import is locked until REAL DATA MODE is enabled.", true);
    return;
  }
  let b64;
  try { b64 = await fileBase64(f); } catch (e) { toast("Could not read file.", true); return; }
  const r = await call("mobile_import", { fileB64: b64, passphrase: pass, dryRun: dry });
  if (!r) return;
  $("#mimp").innerHTML = `<p>Students: <b>${r.would_import}</b> | Scores: <b>${r.would_import_scores}</b></p>` +
    (r.errors.length ? `<ul class="blocking">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "<p class='ok'>✓ Mobile import verified cleanly.</p>");
  if (!dry && !r.errors.length) { DASH = null; render(); }
}

/* ---------------- 3. Scores & Gradebook View ---------------- */
async function scores() {
  let res = [];
  try { res = await inv("results"); } catch (e) { /* assessment weights pending */ }
  const rows = res.map((r) => {
    const m = r.subjects.MATHS ? `${r.subjects.MATHS.avg.toFixed(1)}% (${r.subjects.MATHS.grade})` : "—";
    const e = r.subjects.ENG ? `${r.subjects.ENG.avg.toFixed(1)}% (${r.subjects.ENG.grade})` : "—";
    return `
      <tr>
        <td class="mono"><b>${esc(r.code)}</b></td>
        <td>${esc(r.name)}</td>
        <td>${m}</td>
        <td>${e}</td>
        <td><b>${r.overall.toFixed(1)}%</b></td>
        <td><span class="pill ok">${r.position || "—"}</span></td>
      </tr>
    `;
  }).join("");

  const canEnter = ["admin", "teacher"].includes(SESSION.role);

  return `
  ${canEnter ? `
  <div class="card">
    <h2>Record Assessment Score</h2>
    <div class="actions">
      <input id="sc-stu" size="14" placeholder="Student Reg Code">
      <select id="sc-sub" onchange="scoreLabels()">
        <option>MATHS</option>
        <option>ENG</option>
      </select>
      <span id="sc-labels"></span>
      <input id="sc-val" size="8" placeholder="Score value">
      <button class="act" onclick="doAdd()">Save Score</button>
    </div>
    <p class="muted small">Scores are instantly boundary-checked. Duplicate scores are rejected. All entries are audited under your account.</p>
  </div>

  <div class="card">
    <h2>Correct or remove a score</h2>
    <div class="actions">
      <input id="cor-stu" size="14" placeholder="Student code">
      <select id="cor-sub" onchange="corLabels()">
        <option>MATHS</option>
        <option>ENG</option>
      </select>
      <span id="cor-labels"></span>
      <input id="cor-val" size="8" placeholder="Corrected value">
    </div>
    <div class="actions">
      <input id="cor-reason" class="grow" maxlength="240" placeholder="Audit reason (minimum 8 characters, e.g. Remarking per exam board)">
      <button class="act" onclick="doCorrect()">Save correction</button>
      ${SESSION.role === "admin" ? `<button class="act danger" onclick="doDeleteScore()">Delete all versions</button>` : ""}
    </div>
    <p class="muted small">Score corrections append an immutable audit record. Older marks remain archived in the audit hash chain for transparency.</p>
  </div>
  ` : `
  <div class="card"><p class="muted">Your current user role is view-only for scores.</p></div>
  `}

  <div class="card">
    <h2>Results (deterministic)</h2>
    <table>
      <thead>
        <tr><th>Code</th><th>Name</th><th>MATHS</th><th>ENG</th><th>Overall Average</th><th>Position Rank</th></tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=6 style='text-align:center;padding:24px;color:var(--mut);'>No calculated results yet. Enter student scores above.</td></tr>"}
      </tbody>
    </table>
  </div>
  `;
}

function scoreLabels() {
  const subj = document.querySelector("#sc-sub")?.value || "MATHS";
  const labels = subj === "MATHS" ? ["CA1", "CA2", "Exam"] : ["CA", "Exam"];
  const maxs = subj === "MATHS" ? [20, 20, 60] : [40, 60];
  const el = document.querySelector("#sc-labels");
  if (el) el.innerHTML = `Assessment <select id="sc-lab">${labels.map((l, i) => `<option value="${l}">${l} (max ${maxs[i]})</option>`).join("")}</select>`;
}

function corLabels() {
  const subj = document.querySelector("#cor-sub")?.value || "MATHS";
  const labels = subj === "MATHS" ? ["CA1", "CA2", "Exam"] : ["CA", "Exam"];
  const maxs = subj === "MATHS" ? [20, 20, 60] : [40, 60];
  const el = document.querySelector("#cor-labels");
  if (el) el.innerHTML = `Assessment <select id="cor-lab">${labels.map((l, i) => `<option value="${l}">${l} (max ${maxs[i]})</option>`).join("")}</select>`;
}

async function doAdd() {
  const stu = $("#sc-stu")?.value.trim();
  const val = parseFloat($("#sc-val")?.value);
  if (!stu) { toast("Enter a student registration code.", true); return; }
  if (isNaN(val)) { toast("Enter a valid numeric score.", true); return; }

  const r = await call("score_add", {
    student: stu,
    subject: $("#sc-sub").value,
    label: $("#sc-lab").value,
    value: val,
  }, "Score saved.");
  if (r) { DASH = null; render(); }
}

async function doCorrect() {
  const student = $("#cor-stu")?.value.trim();
  const val = parseFloat($("#cor-val")?.value);
  const reason = $("#cor-reason")?.value.trim();
  if (!student) { toast("Enter student code.", true); return; }
  if (isNaN(val)) { toast("Enter corrected score.", true); return; }
  if (!reason || reason.length < 8) { toast("Audit reason must be at least 8 characters.", true); return; }

  const r = await call("score_update", {
    student,
    subject: $("#cor-sub").value,
    label: $("#cor-lab").value,
    value: val,
    reason,
  }, "Score corrected.");
  if (r) { DASH = null; render(); }
}

async function doDeleteScore() {
  const student = $("#cor-stu")?.value.trim();
  const subject = $("#cor-sub")?.value;
  const label = $("#cor-lab")?.value;
  const reason = $("#cor-reason")?.value.trim();
  if (!student) { toast("Enter the student code first.", true); return; }
  if (!reason || reason.length < 8) { toast("Enter an 8+ character audit reason.", true); return; }

  confirmModal({
    title: "Delete Score Record",
    message: `Delete all score entries for ${student} (${subject} - ${label})? This action is audited.`,
    confirmText: "Delete Record",
    isDanger: true,
    onConfirm: async () => {
      const r = await call("score_delete", { student, subject, label, reason });
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

/* ---------------- 4. Validation Flags View ---------------- */
async function flags() {
  try { await inv("flags_scan"); } catch (e) { /* read-only roles inspect existing */ }
  const list = await inv("flags");
  const canAct = ["admin", "head", "teacher"].includes(SESSION.role);
  
  const rows = list.map((f) => `
    <tr>
      <td class="mono"><b>${esc(f.id)}</b></td>
      <td><span class="pill ${esc(f.severity)}">${esc(f.severity)}</span></td>
      <td class="mono">${esc(f.student_code)}</td>
      <td>${esc(f.subject)} ${esc(f.label)}</td>
      <td class="mono">${esc(f.rule_id)}</td>
      <td>${esc(f.message)}</td>
      <td>
        ${canAct ? `
          <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doFlag('${jsq(f.id)}','corrected')">Correct</button>
          <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doFlagNote('${jsq(f.id)}')">Confirm…</button>
          <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doFlag('${jsq(f.id)}','escalated')">Escalate</button>
        ` : "—"}
      </td>
    </tr>
  `).join("");

  return `
  <div class="card">
    <h2>Flag inbox (${list.length} open) — blocking first</h2>
    <table>
      <thead>
        <tr><th>ID</th><th>Severity</th><th>Student</th><th>Subject/Item</th><th>Rule ID</th><th>Anomaly Message</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=7 style='text-align:center;padding:24px;color:var(--acc);'>✓ Flag inbox clear. No data anomalies detected.</td></tr>"}
      </tbody>
    </table>
    <p class="muted small">Validation flags are generated deterministically by validation rules. Confirming a flag requires an audit explanation.</p>
  </div>
  `;
}

async function doFlag(id, disp) {
  const r = await call("flag_dispose", {
    id,
    disposition: disp,
    note: disp === "corrected" ? "Corrected at hub console" : "Escalated for administrative review",
  }, `Flag marked as ${disp}.`);
  if (r) { DASH = null; render(); }
}

async function doFlagNote(id) {
  promptModal({
    title: "Confirm Flag Exception",
    message: "Enter the documented reason for confirming this score outlier/flag:",
    placeholder: "e.g. Verified against physical examination script",
    confirmText: "Confirm Flag",
    onConfirm: async (note) => {
      if (!note || note.trim().length === 0) {
        toast("A reason note is required.", true);
        return;
      }
      const r = await call("flag_dispose", { id, disposition: "confirmed", note: note.trim() }, "Flag confirmed.");
      if (r) { DASH = null; render(); }
    },
  });
}

/* ---------------- 5. Comments View ---------------- */
async function comments() {
  const stus = await inv("students");
  const canWrite = ["admin", "teacher"].includes(SESSION.role);
  const opts = stus.map((s) => `<option value="${esc(s.short_code)}">${esc(s.short_code)} — ${esc(s.first)} ${esc(s.last)}</option>`).join("");
  
  if (!canWrite) return `<div class="card"><p class="muted">Your user role is read-only for comments.</p></div>`;

  return `
  <div class="card">
    <h2>Comment picker (3 taps + edit)</h2>
    <div class="actions">
      Student <select id="c-stu">${opts || "<option>No students enrolled</option>"}</select>
      Subject <select id="c-sub"><option>MATHS</option><option>ENG</option></select>
      Performance Band <select id="c-band"><option>A</option><option>B</option><option>C</option><option>D</option><option>F</option></select>
      <button class="act ghost" onclick="doPick()">Show sentences</button>
    </div>
    <div id="c-list" style="margin-top:14px;"></div>
    <div id="c-prev" style="margin-top:14px;"></div>
  </div>
  `;
}

async function doPick() {
  const list = await call("comment_pick", { subject: $("#c-sub").value, band: $("#c-band").value });
  if (!list) return;
  $("#c-list").innerHTML = list.map((t) => `
    <div style="background:var(--surface-hover);padding:10px 14px;border-radius:var(--radius-md);margin-bottom:8px;display:flex;align-items:center;gap:12px;">
      <button class="act ghost" style="padding:4px 10px;font-size:12px;" onclick="doPrev('${jsq(t.id)}')">Use</button>
      <span class="mono muted" style="font-size:11px;">${esc(t.id)}</span>
      <span style="flex:1;font-size:13.5px;">${esc(t.text)}</span>
    </div>
  `).join("") || "<p class='muted'>No comment templates found for this band.</p>";
}

async function doPrev(tid) {
  const p = await call("comment_preview", {
    templateId: tid,
    ctx: { name: $("#c-stu").value, subject: $("#c-sub").value, score: "—", strength: "consistent effort", next_step: "practice exercises" },
  });
  if (!p) return;
  $("#c-prev").innerHTML = `
    <div style="border-top:1px solid var(--line);padding-top:14px;margin-top:14px;">
      <label class="field">Customise Teacher Comment
        <textarea id="c-text" rows="3" class="wide-input">${esc(p.text)}</textarea>
      </label>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
        <span class="small muted">${p.chars}/210 characters ${p.blocked ? "<b class='blocking'>EXCEEDS 210 CHAR LIMIT</b>" : ""}</span>
        <button class="act" onclick="doSaveComment('${jsq(tid)}')">Save comment for ${esc($("#c-stu").value)}</button>
      </div>
    </div>
  `;
}

async function doSaveComment(tid) {
  const r = await call("comment_save", {
    student: $("#c-stu").value,
    subject: $("#c-sub").value,
    term: "1T-26",
    templateId: tid,
    text: $("#c-text").value,
  }, "Comment saved.");
  if (r) { DASH = null; render(); }
}

/* ---------------- 6. Reports View ---------------- */
async function reports() {
  const list = await inv("reports");
  const canDraft = ["admin", "teacher"].includes(SESSION.role);

  const rows = list.map((r) => {
    const canTeacher = SESSION.role === "teacher" && r.status === "draft";
    const canHead = SESSION.role === "head" && r.status === "reviewed";
    const canLock = SESSION.role === "head" && r.status === "reviewed";
    
    let statusPill = `<span class="pill off">${esc(r.status)}</span>`;
    if (r.status === "locked") statusPill = `<span class="pill live">LOCKED · SIGNED</span>`;
    else if (r.status === "reviewed") statusPill = `<span class="pill warning">REVIEWED</span>`;

    return `
      <tr>
        <td class="mono"><b>${esc(r.id)}</b></td>
        <td class="mono">${esc(r.student_code)}</td>
        <td><span class="pill off">v${r.version}</span></td>
        <td>${statusPill}</td>
        <td><span class="small">${esc(r.approvals || "None")}</span></td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            ${canTeacher ? `<button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doAppr('${jsq(r.id)}')">Teacher ✓</button>` : ""}
            ${canHead ? `<button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doAppr('${jsq(r.id)}')">Head ✓</button>` : ""}
            ${canLock ? `<button class="act" style="padding:4px 9px;font-size:12px;" onclick="doLock('${jsq(r.id)}')">Lock+Sign</button>` : ""}
            <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doView('${jsq(r.id)}')">View</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  return `
  <div class="card">
    <h2>Reports (${list.length})</h2>
    ${canDraft ? `
      <div style="margin-bottom:14px;">
        <button class="act" onclick="doDraftAll()">Draft all complete students (term 1T-26)</button>
      </div>
    ` : ""}
    ${SESSION.role === "admin" ? `<p class="muted small">Administrators prepare drafts. Teacher and Head accounts review, approve, and sign reports.</p>` : ""}
    <table>
      <thead>
        <tr><th>Report ID</th><th>Student Code</th><th>Version</th><th>Workflow Status</th><th>Signatures</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=6 style='text-align:center;padding:24px;color:var(--mut);'>No draft reports generated yet. Click 'Draft all complete students' above.</td></tr>"}
      </tbody>
    </table>
    <div id="repview"></div>
  </div>
  `;
}

async function doDraftAll() {
  const n = await call("reports_draft_all", { term: "1T-26" }, "Draft reports created.");
  if (n !== null) { DASH = null; render(); }
}

async function doAppr(id) {
  const r = await call("report_approve", { id }, "Approval recorded.");
  if (r) { DASH = null; render(); }
}

async function doLock(id) {
  confirmModal({
    title: "Lock & Cryptographically Sign Report",
    message: `Sign this report card with the school's private Ed25519 key? Once locked, marks cannot be altered without re-drafting.`,
    confirmText: "Sign & Lock",
    onConfirm: async () => {
      const qr = await call("report_lock", { id }, "Report locked and signed.");
      if (qr) {
        showModalDialog({
          title: "Cryptographic Signature Generated",
          bodyHtml: `<p>Report signed with local Ed25519 key:</p><pre class="recovery" style="font-size:11px;">${esc(qr)}</pre>`,
          confirmText: "Done",
        });
        DASH = null;
        render();
      }
    },
  });
}

async function doView(id) {
  const html = await call("report_html", { id });
  if (!html) return;
  let wrap = $("#printwrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "printwrap";
    wrap.innerHTML = `
      <div class="printbar">
        <b>Formal Report Card Preview</b>
        <span class="spacer"></span>
        <button class="act" id="pprint">Print to PDF / Printer</button>
        <button class="act ghost" id="pclose" style="color:#fff;border-color:rgba(255,255,255,0.3);background:transparent;">Close</button>
      </div>
      <iframe id="printframe" title="Report preview"></iframe>
    `;
    document.body.appendChild(wrap);
    $("#pclose").onclick = () => wrap.remove();
    $("#pprint").onclick = () => $("#printframe").contentWindow.print();
  }
  $("#printframe").srcdoc = html;
}

/* ---------------- 7. Backup & Vault Gate View ---------------- */
async function backup() {
  const d = await inv("dashboard");
  DASH = d;
  applyHeader(d);
  
  let list = [];
  try { list = await inv("backup_list"); } catch (e) { /* admin only */ }
  const isAdmin = SESSION.role === "admin";
  
  const rows = list.map((b) => `
    <tr>
      <td class="mono"><b>${esc(b.id)}</b></td>
      <td>${esc(b.created_at)}</td>
      <td>${b.students}</td>
      <td>${b.scores}</td>
      <td>${b.reports}</td>
      <td class="mono small">${esc(String(b.sha256 || "").slice(0, 16))}…</td>
      <td>
        ${isAdmin ? `<button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doVerifyId('${jsq(b.id)}')">Verify</button>` : ""}
      </td>
    </tr>
  `).join("");

  const gate = d.test_override
    ? `<div class="banner warn"><b>REAL DATA TEST MODE</b> — the production real-data gate was bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.</div>`
    : d.live
      ? `<div class="banner real"><b>REAL DATA MODE</b> — Vault is fully armed. Maintain daily offline encrypted backups.</div>`
      : `<div class="banner demo"><b>REAL-DATA GATE</b> — complete these steps before importing real students.</div>`;

  const demoRows = (d.students || 0) + (d.scores || 0) + (d.reports || 0);

  const testPanel = isAdmin && d.test_override_available && !d.live ? `
  <div class="card">
    <h2>Test-only real-data unlock</h2>
    <p class="muted small">This build is running in test mode (<code>AGM_TEST_ALLOW_REAL_DATA=1</code>). The override skips the verified-backup, drill and privacy checks, records your reason in the audit log, and shows a red TEST MODE banner on every screen. Use synthetic or explicitly authorized test data only; this is not a production approval.</p>
    <div class="actions">
      <button class="act danger" ${demoRows > 0 ? "disabled" : ""} onclick="doEnableRealTest()">Enable real data for testing</button>
    </div>
    ${demoRows > 0 ? `<p class="warning small" style="margin-top:6px;">Clear demo data first.</p>` : ""}
  </div>` : "";

  return `
  ${gate}
  ${testPanel}

  <div class="card">
    <h2>Backup &amp; restore gate</h2>
    <div style="background:var(--surface-hover);padding:14px 18px;border-radius:var(--radius-md);margin-bottom:14px;">
      <p style="margin:0 0 6px;">
        Backup verified: <b class="${d.backup_verified ? "ok" : "blocking"}">${d.backup_verified ? "yes" : "no"}</b> ·
        Drill passed: <b class="${d.drill_passed ? "ok" : "blocking"}">${d.drill_passed ? "yes" : "no"}</b> ·
        Privacy acknowledged: <b class="${d.privacy_ack ? "ok" : "blocking"}">${d.privacy_ack ? "yes" : "no"}</b> ·
        Mode: <b>${esc(d.data_mode)}</b>
      </p>
      <p class="muted small" style="margin:0;">A backup is an encrypted whole-database snapshot (XChaCha20-Poly1305). The restore drill validates that data can be decrypted and recovered without touching live records.</p>
    </div>

    ${isAdmin ? `
    <div class="actions">
      ${!d.live ? `<button class="act danger" ${d.students > 0 ? "" : "disabled"} onclick="doClearDemo()">0. Clear demo data</button>` : ""}
      <button class="act" onclick="doBackup()">1. Backup now</button>
      <button class="act ghost" onclick="doVerify()">2. Verify latest</button>
      <button class="act ghost" onclick="doDrill()">3. Run restore drill</button>
      ${!d.privacy_ack ? `<button class="act ghost" onclick="doPrivacy()">4. Acknowledge privacy notice</button>` : ""}
      <button class="act" ${d.backup_verified && d.drill_passed && d.privacy_ack && !d.live ? "" : "disabled"} onclick="doEnableReal()">5. Enable real data</button>
      <button class="act danger" onclick="doRestore()">Restore latest…</button>
      <button class="act danger" ${(d.students + d.scores + d.reports) > 0 ? "" : "disabled"} onclick="doPurgeAll()">Purge all live data…</button>
    </div>
    ` : `<p class="muted">Only administrators can manage vault backups and restore drills.</p>`}
  </div>

  <div class="card">
    <h2>Backup history</h2>
    <table>
      <thead>
        <tr><th>Snapshot ID</th><th>Created Timestamp</th><th>Students</th><th>Scores</th><th>Reports</th><th>SHA-256 Digest</th><th>Action</th></tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=7 style='text-align:center;padding:24px;color:var(--mut);'>No vault snapshots created yet. Click '1. Backup now' above.</td></tr>"}
      </tbody>
    </table>
    <p class="muted small">Always mirror the <code>.agm</code> encrypted blob, <code>.json</code> manifest, and <code>vault-BK-*.json</code> key wrapper to an offsite USB flash drive.</p>
  </div>
  `;
}

async function doClearDemo() {
  confirmModal({
    title: "Clear All Demo & Sample Data",
    message: "Permanently delete all sample students, demo marks, and draft reports? This ensures a clean database for your school pilot.",
    confirmText: "Clear All Demo Data",
    isDanger: true,
    onConfirm: async () => {
      const r = await call("clear_demo", {}, null);
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

async function doBackup() {
  const r = await call("backup_create", {}, "Encrypted backup created and verified.");
  if (r) { DASH = null; render(); }
}

async function doVerify() {
  const r = await call("backup_verify", {}, null);
  if (r) toast(`Verified snapshot ${r.backup_id}: ${r.students} students, ${r.scores} scores. Audit chain verified.`);
}

async function doVerifyId(id) {
  const r = await call("backup_verify", { backupId: id }, null);
  if (r) toast(`Verified snapshot ${r.backup_id}: ${r.students} students, ${r.scores} scores.`);
}

async function doDrill() {
  const r = await call("drill_run", {}, null);
  if (r) { toast(r); DASH = null; render(); }
}

async function doPrivacy() {
  const r = await call("privacy_ack", {}, "Privacy notice and data controller obligations acknowledged.");
  if (r) { DASH = null; render(); }
}

async function doEnableReal() {
  confirmModal({
    title: "Activate REAL DATA MODE",
    message: "Arm the hub for real student data? Confirm that school authorization, parental notice, and device security policies are active.",
    confirmText: "Activate Real Data Mode",
    onConfirm: async () => {
      const r = await call("enable_real_mode", {}, null);
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

async function doEnableRealTest() {
  promptModal({
    title: "Real Data Test Mode Override",
    message: "Enter the documented reason for the test override (minimum 12 characters, recorded in audit trail):",
    placeholder: "Authorized pilot test evaluation",
    confirmText: "Unlock Test Override",
    onConfirm: async (reason) => {
      if (!reason || reason.trim().length < 12) {
        toast("A reason of at least 12 characters is required.", true);
        return;
      }
      const r = await call("enable_real_mode", { testOverrideReason: reason.trim() }, null);
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

async function doRestore() {
  confirmModal({
    title: "Restore from Latest Backup Snapshot",
    message: "Restore the latest verified backup? All modifications since the last backup will be replaced with snapshot state.",
    confirmText: "Restore Snapshot",
    isDanger: true,
    onConfirm: async () => {
      const r = await call("restore_backup", {}, null);
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

async function doPurgeAll() {
  promptModal({
    title: "PURGE ALL LIVE DATA",
    message: "Warning: Permanently wipes every student, score, flag, comment, and report from live memory. Type PURGE to confirm:",
    placeholder: "PURGE",
    confirmText: "Wipe Live Records",
    isDanger: true,
    onConfirm: async (typed) => {
      if (!typed || typed.trim() !== "PURGE") {
        toast("Confirmation did not match. Nothing was purged.", true);
        return;
      }
      const r = await call("purge_all_data", { confirm: typed.trim() });
      if (r) { toast(r); DASH = null; render(); }
    },
  });
}

/* ---------------- 8. Staff & Users View ---------------- */
async function users() {
  if (SESSION.role !== "admin") return `<div class="card"><p class="muted">Administrative access only.</p></div>`;
  const list = await inv("users_list");
  
  const rows = list.map((u) => `
    <tr>
      <td><b>${esc(u.username)}</b></td>
      <td><span class="pill ok">${esc(u.role)}</span></td>
      <td>${u.must_change ? "<b class='warning'>YES (Temporary)</b>" : "<span class='muted'>No</span>"}</td>
      <td>${esc(u.created_at)}</td>
      <td>
        <button class="act ghost" style="padding:4px 9px;font-size:12px;" onclick="doResetUser('${jsq(u.username)}')">Reset password</button>
        <button class="act danger" style="padding:4px 9px;font-size:12px;" onclick="doRemoveUser('${jsq(u.username)}')">Remove</button>
      </td>
    </tr>
  `).join("");

  return `
  <div class="card">
    <h2>Staff accounts (${list.length})</h2>
    <p class="muted small">Role-based access is strictly enforced in Rust backend. Administrators manage accounts; Teachers and School Heads review and sign report cards.</p>
    <table>
      <thead>
        <tr><th>Staff Username</th><th>Role Designation</th><th>Password Change Required</th><th>Creation Date</th><th>Account Actions</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>

  <div class="card">
    <h2>Add a staff account</h2>
    <div class="actions">
      <input id="nu-user" placeholder="Staff username" autocomplete="off">
      <select id="nu-role">
        <option value="teacher">Teacher</option>
        <option value="head">Head Reviewer / Principal</option>
        <option value="viewer">Viewer / Auditor</option>
        <option value="admin">Administrator</option>
      </select>
      <input id="nu-pass" type="password" placeholder="Temporary password (12+ chars)" autocomplete="new-password">
      <button class="act" onclick="doAddUser()">Add user</button>
    </div>
    <p class="muted small">Hand the temporary passphrase to the staff member in person. The user must change it on initial unlock.</p>
  </div>
  `;
}

async function doAddUser() {
  const username = $("#nu-user")?.value.trim();
  const role = $("#nu-role")?.value;
  const tempPassword = $("#nu-pass")?.value;
  if (!username) { toast("Enter staff username.", true); return; }
  if (!tempPassword || tempPassword.length < 12) { toast("Temporary password must be at least 12 characters.", true); return; }

  const r = await call("user_add", { username, role, tempPassword }, "User account added.");
  if (r) {
    $("#nu-user").value = "";
    $("#nu-pass").value = "";
    render();
  }
}

async function doResetUser(username) {
  promptModal({
    title: `Reset Password for ${username}`,
    message: "Enter a new temporary password (12+ characters):",
    placeholder: "Temporary passphrase",
    confirmText: "Reset Passphrase",
    onConfirm: async (p) => {
      if (!p || p.length < 12) {
        toast("Password must be at least 12 characters.", true);
        return;
      }
      const r = await call("user_reset_password", { username, newPassword: p }, "Password reset.");
      if (r) render();
    },
  });
}

async function doRemoveUser(username) {
  confirmModal({
    title: `Remove Staff User: ${username}`,
    message: `Remove account ${username}? This user will no longer be able to unlock the hub.`,
    confirmText: "Remove User",
    isDanger: true,
    onConfirm: async () => {
      const r = await call("user_remove", { username }, "User removed.");
      if (r) render();
    },
  });
}

/* ---------------- 9. Account & Keys View ---------------- */
async function account() {
  let fp = "";
  try { fp = await inv("hub_fingerprint"); } catch (e) { fp = String(e); }

  return `
  <div class="card">
    <h2>Current Session &amp; Identity</h2>
    <p>Signed in as: <b>${esc(SESSION.username)}</b> · Role: <span class="pill ok">${esc(roleLabel(SESSION.role))}</span></p>
    <p class="muted small">Active sessions automatically lock after 15 minutes of inactivity. Always lock manually when stepping away.</p>
    <button class="act ghost" onclick="lockApp()">Lock now</button>
  </div>

  <div class="card">
    <h2>Hub signing key fingerprint</h2>
    <div style="background:var(--surface-hover);padding:14px;border-radius:var(--radius-md);margin:10px 0;">
      <p class="mono" id="hub-fp" style="margin:0;font-weight:650;font-size:13px;word-break:break-all;">${esc(fp)}</p>
    </div>
    <p class="muted small">Derived from this Hub's local Ed25519 public key. Parents and regulators can compare printed report card signatures against this fingerprint to verify document authenticity.</p>
    <button class="act ghost" onclick="refreshFingerprint()">Refresh</button>
  </div>

  <div class="card">
    <h2>Change account password</h2>
    <form onsubmit="doChangePassword(event,true)">
      <label class="field">Current password
        <input id="ac-old" type="password" required autocomplete="current-password">
      </label>
      <label class="field">New password (12+ characters)
        <input id="ac-new" type="password" minlength="12" required autocomplete="new-password">
      </label>
      <label class="field">Confirm new password
        <input id="ac-confirm" type="password" minlength="12" required autocomplete="new-password">
      </label>
      <button class="act" type="submit">Update Password</button>
    </form>
  </div>
  `;
}

async function refreshFingerprint() {
  const fp = await call("hub_fingerprint");
  if (fp) $("#hub-fp").textContent = fp;
}

/* ---------------- 10. Audit Log View ---------------- */
async function audit() {
  const list = await inv("audit_list");
  const rows = list.map((a) => `
    <tr>
      <td class="mono">#${a.seq}</td>
      <td><b>${esc(a.actor)}</b></td>
      <td><span class="pill off">${esc(a.action)}</span></td>
      <td>${esc(a.entity)}</td>
    </tr>
  `).join("");

  return `
  <div class="card">
    <h2>Audit trail (latest 200 events)</h2>
    <p class="muted small">Cryptographically hash-chained and sealed at rest. Every score change, approval, and backup is recorded with actor and timestamp.</p>
    <table>
      <thead>
        <tr><th>Sequence</th><th>Actor</th><th>Action Event</th><th>Affected Entity</th></tr>
      </thead>
      <tbody>
        ${rows || "<tr><td colspan=4 style='text-align:center;padding:24px;color:var(--mut);'>No audit entries recorded yet.</td></tr>"}
      </tbody>
    </table>
  </div>
  `;
}

/* ---------------- Global Bindings ---------------- */
document.querySelectorAll("#nav button").forEach((b) => {
  b.onclick = () => go(b.dataset.s);
});

const lockBtn = $("#lock-btn");
if (lockBtn) lockBtn.onclick = () => lockApp();

document.addEventListener("pointerdown", resetIdle, true);
document.addEventListener("keydown", (e) => {
  resetIdle();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "l") {
    e.preventDefault();
    lockApp();
  }
}, true);

boot();
