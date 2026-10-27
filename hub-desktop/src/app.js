/* Agent Mark Hub console — vanilla JS over Tauri invoke.
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

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = String(msg);
  t.style.display = "block";
  t.style.background = bad ? "#7a1f1a" : "#10231b";
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.display = "none"), 5200);
}

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
  return ({ admin: "Admin", head: "Head", teacher: "Teacher", viewer: "Viewer" })[r] || r;
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
    setAuth(`<div class="auth-card"><h2>Agent Mark Hub</h2><p class="blocking">${esc(e)}</p>
      <p class="muted">If this keeps happening, restore <code>vault.json</code> from the school backup kit.</p></div>`);
  }
}

/* ---------- auth screens ---------- */
function showSetup() {
  setAuth(`<div class="auth-card">
    <div class="brand">Agent Mark Hub</div>
    <h2>Set up this school PC</h2>
    <p class="muted">This creates the encrypted vault and the first admin account. The recovery code is shown once — keep it in the school safe.</p>
    <form onsubmit="doSetup(event)">
      <label class="field">School name<input id="su-school" maxlength="80" required placeholder="e.g. Greenfield Secondary School"></label>
      <label class="field">Admin username<input id="su-user" required autocomplete="username" placeholder="e.g. admin.head"></label>
      <label class="field">Admin password<input id="su-pass" type="password" minlength="12" required autocomplete="new-password" placeholder="12+ characters"></label>
      <label class="field">Confirm password<input id="su-confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Create encrypted hub</button>
    </form>
    <p class="fine">No cloud. No AI. Student data stays on this PC.</p>
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
    <div class="brand">Save the recovery code</div>
    <h2>This is shown once</h2>
    <p class="muted">If every admin forgets their password, this code is the only way back into the data. Print it, seal it, and keep it in the school safe. Do not store it on this PC.</p>
    <pre class="recovery">${esc(code)}</pre>
    <button class="act ghost" type="button" onclick="copyRecovery()">Copy code</button>
    <label class="check"><input id="saved-code" type="checkbox"> I have written this down and stored it offline.</label>
    <button class="act wide" type="button" onclick="finishSetup()">Continue to the hub</button>
  </div>`);
}

async function copyRecovery() {
  try {
    await navigator.clipboard.writeText(PENDING_RECOVERY);
    toast("Recovery code copied. Store it offline, then clear the clipboard.");
  } catch (e) {
    toast("Copy failed — write the code down by hand.", true);
  }
}

function finishSetup() {
  if (!$("#saved-code") || !$("#saved-code").checked) {
    toast("Confirm that you saved the recovery code.", true);
    return;
  }
  PENDING_RECOVERY = "";
  boot();
}

function showLogin(msg) {
  setAuth(`<div class="auth-card">
    <div class="brand">Agent Mark Hub</div>
    <h2>Unlock this hub</h2>
    <p class="muted">The database is encrypted. Sign in with your school account.</p>
    <form onsubmit="doUnlock(event)">
      <label class="field">Username<input id="li-user" required autocomplete="username"></label>
      <label class="field">Password<input id="li-pass" type="password" required autocomplete="current-password"></label>
      <div id="auth-err" class="auth-err">${msg ? esc(msg) : ""}</div>
      <button class="act wide" type="submit">Unlock</button>
    </form>
    <p class="fine"><a href="#" onclick="showRecovery();return false;">Forgot password? Use the recovery code</a></p>
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
    <div class="brand">Recovery</div>
    <h2>Reset a password</h2>
    <p class="muted">Enter the offline recovery code and set a new password. The account will be forced to change it at next sign-in.</p>
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
  if (r) showLogin("Password reset. Sign in with the new password.");
}

function showRecoverFromBackup() {
  setAuth(`<div class="auth-card">
    <div class="brand">Disaster recovery</div>
    <h2>Restore this PC from a backup</h2>
    <p class="muted">Use this when <code>hub.db</code> is missing or damaged but <code>vault.json</code> and an encrypted backup survived. Copy the backup's <code>.agm</code> and <code>.json</code> files into the <code>backups</code> folder in the Agent Mark data directory first.</p>
    <form onsubmit="doRecoverFromBackup(event)">
      <label class="field">Username<input id="rb-user" required autocomplete="username"></label>
      <label class="field">Password<input id="rb-pass" type="password" required autocomplete="current-password"></label>
      <label class="field">Backup ID (optional)<input id="rb-id" autocomplete="off" placeholder="Leave blank for the newest backup"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Verify and restore backup</button>
    </form>
    <p class="fine">The backup is verified before it replaces anything. The current database, if present, is archived in the same backups folder.</p>
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
  toast("Backup restored. Run a new restore drill before any real-data changes.");
}

function showChangePassword() {
  setAuth(`<div class="auth-card">
    <div class="brand">Agent Mark Hub</div>
    <h2>Change your password</h2>
    <p class="muted">This account is using a temporary password. Set your own before continuing.</p>
    <form onsubmit="doChangePassword(event,false)">
      <label class="field">Current password<input id="cp-old" type="password" required autocomplete="current-password"></label>
      <label class="field">New password<input id="cp-new" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field">Confirm new password<input id="cp-confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <div id="auth-err" class="auth-err"></div>
      <button class="act wide" type="submit">Change password</button>
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
    toast("Password changed.");
    render();
  } else {
    SESSION.must_change = false;
    showApp();
  }
}

/* ---------- app shell ---------- */
function showApp() {
  if (!SESSION) return boot();
  document.body.classList.remove("auth-mode");
  $("#auth").innerHTML = "";
  $("#user-chip").textContent = `${SESSION.username} · ${roleLabel(SESSION.role)}`;
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
  $("#school-label").textContent = d.school_name || "";
  $("#mode-badge").textContent = d.test_override ? "TEST DATA" : (d.live ? "REAL DATA" : "DEMO");
  $("#mode-badge").className = "pill " + (d.test_override ? "warning" : (d.live ? "live" : "off"));
  $("#user-chip").textContent = `${d.username} · ${roleLabel(d.role)}`;
}

async function render() {
  if (!SESSION) return boot();
  if (SESSION.must_change) return showChangePassword();
  const v = $("#view");
  v.innerHTML = "<div class='card'>Loading…</div>";
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
    if (SEC === "scores") scoreLabels();
  } catch (e) {
    v.innerHTML = `<div class='card blocking'>${esc(e)}</div>`;
  }
}

/* ---------- dashboard ---------- */
async function dash() {
  DASH = await inv("dashboard");
  applyHeader(DASH);
  const block = DASH.blocking.map((b) => `<li class="blocking">${esc(b)}</li>`).join("") || "<li class='ok'>None.</li>";
  const warn = DASH.warning.map((b) => `<li class="warning">${esc(b)}</li>`).join("") || "<li>None.</li>";
  const modeBanner = DASH.test_override
    ? `<div class="banner warn"><b>REAL DATA TEST MODE</b> — the production real-data gate was bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.</div>`
    : DASH.live
      ? `<div class="banner real"><b>REAL DATA MODE</b> — only authorized student data. Back up before every bulk change.</div>`
      : `<div class="banner demo"><b>DEMO MODE</b> — synthetic data only. Real import is locked until the gate is complete.</div>`;
  const must = DASH.must_change
    ? `<div class="banner warn">You are using a temporary password. <button class="act ghost" onclick="showChangePassword()">Change it now</button></div>`
    : "";
  const schoolForm = SESSION.role === "admin"
    ? `<div class="card"><h2>School name</h2>
       <p class="muted small">Printed on every report card. Changes are audited.</p>
       <div class="actions"><input id="school-name" value="${esc(DASH.school_name)}" maxlength="80" class="grow">
       <button class="act" onclick="doSchool()">Save name</button></div></div>`
    : "";
  return `${modeBanner}${must}
  <div class="grid">
    <div class="stat"><b>${DASH.students}</b><span>students</span></div>
    <div class="stat"><b>${DASH.scores}</b><span>scores</span></div>
    <div class="stat ${DASH.flags_open ? "warn" : ""}"><b>${DASH.flags_open}</b><span>open flags</span></div>
    <div class="stat"><b>${DASH.reports_locked}</b><span>locked reports</span></div>
    <div class="stat ${DASH.backup_verified ? "ok" : "bad"}"><b>${DASH.backup_verified ? "yes" : "no"}</b><span>backup verified</span></div>
    <div class="stat ${DASH.drill_passed ? "ok" : "bad"}"><b>${DASH.drill_passed ? "yes" : "no"}</b><span>drill passed</span></div>
    ${DASH.test_override ? `<div class="stat bad"><b>TEST</b><span>gate bypassed</span></div>` : ""}
  </div>
  <div class="card"><h2>Readiness checklist</h2><ul>${block}</ul><h2>Warnings</h2><ul>${warn}</ul>
    <div class="actions">
      <button class="act ghost" onclick="go('backup')">Backup &amp; real-data gate</button>
      ${SESSION.role === "admin" && !DASH.live ? `<button class="act ghost" onclick="doSeed()">Load demo school</button>` : ""}
    </div>
  </div>
  ${schoolForm}`;
}

async function doSeed() {
  const r = await call("seed_demo", {}, "Demo school loaded.");
  if (r) { DASH = null; render(); }
}

async function doSchool() {
  const r = await call("school_set", { name: $("#school-name").value.trim() }, "School name saved.");
  if (r) { DASH = null; render(); }
}

/* ---------- students ---------- */
async function students() {
  const list = await inv("students");
  const rows = list.map((s) => `<tr><td>${esc(s.short_code)}</td><td>${esc(s.first)} ${esc(s.last)}</td><td>${esc(s.class)}</td></tr>`).join("");
  const canImport = SESSION.role === "admin" && DASH && DASH.live;
  return `<div class="card"><h2>Students (${list.length})</h2>
    <table><tr><th>Code</th><th>Name</th><th>Class</th></tr>${rows || "<tr><td colspan=3>No students — load demo or import.</td></tr>"}</table></div>
  <div class="card"><h2>CSV roster import</h2>
    <p class="muted small">Header: <code>short_code,first_name,last_name,class_label</code>. Dry-run first. Real import is admin-only and requires REAL DATA MODE.</p>
    <textarea id="csv" rows="6" class="wide-input" placeholder="short_code,first_name,last_name,class_label&#10;26-JSS2A-007,Adaeze,Demo,JSS2-A"></textarea>
    <div class="actions">
      <button class="act ghost" onclick="doImport(true)">Dry-run check</button>
      <button class="act" ${canImport ? "" : "disabled"} onclick="doImport(false)">Import for real</button>
    </div>
    ${canImport ? "" : `<p class="warning small">Real import is locked. Complete the backup gate and enable real data first.</p>`}
    <div id="imp"></div></div>
  <div class="card"><h2>Import from phone (.agmm)</h2>
    <p class="muted small">Encrypted transfer file from the mobile companion. Enter the transfer passphrase set on the phone — not the desktop password. Dry-run first; real import is admin-only and requires REAL DATA MODE.</p>
    <input type="file" id="agmm-file" accept=".agmm,application/octet-stream">
    <input id="agmm-pass" type="password" class="wide-input" placeholder="Transfer passphrase (12+ characters)">
    <div class="actions">
      <button class="act ghost" onclick="doMobileImport(true)">Dry-run check</button>
      <button class="act" ${canImport ? "" : "disabled"} onclick="doMobileImport(false)">Import from phone</button>
    </div>
    <div id="mimp"></div></div>`;
}

async function doImport(dry) {
  if (!dry && (!DASH || !DASH.live)) {
    toast("Real import is locked until REAL DATA MODE is enabled.", true);
    return;
  }
  const r = await call("roster_import", { csvText: $("#csv").value, dryRun: dry });
  if (!r) return;
  $("#imp").innerHTML = `<p>Would import: <b>${r.would_import}</b></p>` +
    (r.errors.length ? `<ul class="blocking">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "<p class='ok'>No errors.</p>");
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
  const f = $("#agmm-file").files[0];
  if (!f) { toast("Choose an .agmm file first.", true); return; }
  const pass = $("#agmm-pass").value;
  if (!pass) { toast("Enter the transfer passphrase.", true); return; }
  if (!dry && (!DASH || !DASH.live)) {
    toast("Real import is locked until REAL DATA MODE is enabled.", true);
    return;
  }
  let b64;
  try { b64 = await fileBase64(f); } catch (e) { toast("Could not read that file.", true); return; }
  const r = await call("mobile_import", { fileB64: b64, passphrase: pass, dryRun: dry });
  if (!r) return;
  $("#mimp").innerHTML = `<p>Would import: <b>${r.would_import}</b> students, <b>${r.would_import_scores}</b> scores</p>` +
    (r.errors.length ? `<ul class="blocking">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "<p class='ok'>No errors.</p>");
  if (!dry && !r.errors.length) { DASH = null; render(); }
}

/* ---------- scores ---------- */
async function scores() {
  let res = [];
  try { res = await inv("results"); } catch (e) { /* weights gate */ }
  const rows = res.map((r) => {
    const m = r.subjects.MATHS ? `${r.subjects.MATHS.avg.toFixed(1)}% (${r.subjects.MATHS.grade})` : "—";
    const e = r.subjects.ENG ? `${r.subjects.ENG.avg.toFixed(1)}% (${r.subjects.ENG.grade})` : "—";
    return `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${m}</td><td>${e}</td><td>${r.overall.toFixed(1)}%</td><td>${r.position || "—"}</td></tr>`;
  }).join("");
  const canEnter = ["admin", "teacher"].includes(SESSION.role);
  return `${canEnter ? `<div class="card"><h2>Enter score</h2>
    <div class="actions">
      <input id="sc-stu" size="14" placeholder="26-JSS2A-001">
      <select id="sc-sub" onchange="scoreLabels()"><option>MATHS</option><option>ENG</option></select>
      <span id="sc-labels"></span>
      <input id="sc-val" size="6" placeholder="17">
      <button class="act" onclick="doAdd()">Save</button>
    </div>
    <p class="muted small">Range-checked instantly (VAL-RANGE-01); conflicting entries are refused (VAL-DUP-01). Every save is audited to your account.</p></div>` : `<div class="card"><p class="muted">Your role is read-only for score entry.</p></div>`}
  <div class="card"><h2>Results (deterministic)</h2>
    <table><tr><th>Code</th><th>Name</th><th>MATHS</th><th>ENG</th><th>Overall</th><th>Pos</th></tr>${rows || "<tr><td colspan=6>No complete results yet.</td></tr>"}</table></div>`;
}

function scoreLabels() {
  const subj = document.querySelector("#sc-sub")?.value || "MATHS";
  const labels = subj === "MATHS" ? ["CA1", "CA2", "Exam"] : ["CA", "Exam"];
  const maxs = subj === "MATHS" ? [20, 20, 60] : [40, 60];
  const el = document.querySelector("#sc-labels");
  if (el) el.innerHTML = `Assessment <select id="sc-lab">${labels.map((l, i) => `<option value="${l}">${l} (max ${maxs[i]})</option>`).join("")}</select>`;
}

async function doAdd() {
  const r = await call("score_add", {
    student: $("#sc-stu").value.trim(),
    subject: $("#sc-sub").value,
    label: $("#sc-lab").value,
    value: parseFloat($("#sc-val").value),
  }, "Score saved.");
  if (r) { DASH = null; render(); }
}

/* ---------- flags ---------- */
async function flags() {
  try { await inv("flags_scan"); } catch (e) { /* read-only roles still see existing flags */ }
  const list = await inv("flags");
  const canAct = ["admin", "head", "teacher"].includes(SESSION.role);
  const rows = list.map((f) => `<tr><td>${esc(f.id)}</td><td><span class="pill ${esc(f.severity)}">${esc(f.severity)}</span></td>
    <td>${esc(f.student_code)}</td><td>${esc(f.subject)} ${esc(f.label)}</td><td>${esc(f.rule_id)}</td><td>${esc(f.message)}</td>
    <td>${canAct ? `<button class="act ghost" onclick="doFlag('${jsq(f.id)}','corrected')">Correct</button>
      <button class="act ghost" onclick="doFlagNote('${jsq(f.id)}')">Confirm…</button>
      <button class="act ghost" onclick="doFlag('${jsq(f.id)}','escalated')">Escalate</button>` : "—"}</td></tr>`).join("");
  return `<div class="card"><h2>Flag inbox (${list.length} open) — blocking first</h2>
    <table><tr><th>ID</th><th>Severity</th><th>Student</th><th>Where</th><th>Rule</th><th>Message</th><th>Action</th></tr>
    ${rows || "<tr><td colspan=7 class='ok'>Inbox clear.</td></tr>"}</table>
    <p class="muted small">Confirm requires a reason note. Nothing here auto-changes a score.</p></div>`;
}

async function doFlag(id, disp) {
  const r = await call("flag_dispose", { id, disposition: disp, note: disp === "corrected" ? "corrected at hub" : "escalated to head" }, `Flag ${disp}.`);
  if (r) { DASH = null; render(); }
}

async function doFlagNote(id) {
  const note = prompt("Reason for confirming (required):");
  if (!note) return;
  const r = await call("flag_dispose", { id, disposition: "confirmed", note }, "Flag confirmed.");
  if (r) { DASH = null; render(); }
}

/* ---------- comments ---------- */
async function comments() {
  const stus = await inv("students");
  const canWrite = ["admin", "teacher"].includes(SESSION.role);
  const opts = stus.map((s) => `<option value="${esc(s.short_code)}">${esc(s.short_code)} ${esc(s.first)}</option>`).join("");
  if (!canWrite) return `<div class="card"><p class="muted">Your role is read-only for comments.</p></div>`;
  return `<div class="card"><h2>Comment picker (3 taps + edit)</h2>
    <div class="actions">
      Student <select id="c-stu">${opts}</select>
      Subject <select id="c-sub"><option>MATHS</option><option>ENG</option></select>
      Band <select id="c-band"><option>A</option><option>B</option><option>C</option><option>D</option><option>F</option></select>
      <button class="act ghost" onclick="doPick()">Show sentences</button>
    </div>
    <div id="c-list"></div>
    <div id="c-prev"></div></div>`;
}

async function doPick() {
  const list = await call("comment_pick", { subject: $("#c-sub").value, band: $("#c-band").value });
  if (!list) return;
  $("#c-list").innerHTML = list.map((t) => `<p><button class="act ghost" onclick="doPrev('${jsq(t.id)}')">Use</button> <small>${esc(t.id)}</small> ${esc(t.text)}</p>`).join("") || "<p>No templates.</p>";
}

async function doPrev(tid) {
  const p = await call("comment_preview", {
    templateId: tid,
    ctx: { name: $("#c-stu").value, subject: $("#c-sub").value, score: "—", strength: "problem solving", next_step: "daily practice" },
  });
  if (!p) return;
  $("#c-prev").innerHTML = `<textarea id="c-text" rows="3" class="wide-input">${esc(p.text)}</textarea><br>
    <small>${p.chars}/210 ${p.blocked ? "<b class='blocking'>TOO LONG</b>" : ""}</small><br>
    <button class="act" onclick="doSaveComment('${jsq(tid)}')">Save comment for ${esc($("#c-stu").value)}</button>`;
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

/* ---------- reports ---------- */
async function reports() {
  const list = await inv("reports");
  const canDraft = ["admin", "teacher"].includes(SESSION.role);
  const rows = list.map((r) => {
    const canTeacher = SESSION.role === "teacher" && r.status === "draft";
    const canHead = SESSION.role === "head" && r.status === "reviewed";
    const canLock = SESSION.role === "head" && r.status === "reviewed";
    return `<tr><td>${esc(r.id)}</td><td>${esc(r.student_code)}</td><td>v${r.version}</td><td>${esc(r.status)}</td><td>${esc(r.approvals)}</td>
      <td>${canTeacher ? `<button class="act ghost" onclick="doAppr('${jsq(r.id)}')">Teacher ✓</button>` : ""}
      ${canHead ? `<button class="act ghost" onclick="doAppr('${jsq(r.id)}')">Head ✓</button>` : ""}
      ${canLock ? `<button class="act" onclick="doLock('${jsq(r.id)}')">Lock+Sign</button>` : ""}
      <button class="act ghost" onclick="doView('${jsq(r.id)}')">View</button></td></tr>`;
  }).join("");
  return `<div class="card"><h2>Reports (${list.length})</h2>
    ${canDraft ? `<button class="act" onclick="doDraftAll()">Draft all complete students (term 1T-26)</button>` : ""}
    ${SESSION.role === "admin" ? `<p class="muted small">Admin can prepare drafts but cannot approve. Teacher and Head accounts must approve.</p>` : ""}
    <table><tr><th>ID</th><th>Student</th><th>Ver</th><th>Status</th><th>Approvals</th><th>Action</th></tr>${rows || "<tr><td colspan=6>No drafts yet.</td></tr>"}</table>
    <div id="repview"></div></div>`;
}

async function doDraftAll() {
  const n = await call("reports_draft_all", { term: "1T-26" }, "Drafts created.");
  if (n !== null) { DASH = null; render(); }
}
async function doAppr(id) {
  const r = await call("report_approve", { id }, "Approval recorded.");
  if (r) { DASH = null; render(); }
}
async function doLock(id) {
  const qr = await call("report_lock", { id }, "Locked + signed.");
  if (qr) { alert("QR/signature:\n" + qr); DASH = null; render(); }
}
async function doView(id) {
  const html = await call("report_html", { id });
  if (!html) return;
  let wrap = $("#printwrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "printwrap";
    wrap.innerHTML = `<div class="printbar"><b>Report preview</b><span class="spacer"></span><button class="act" id="pprint">Print</button><button class="act ghost" id="pclose">Close</button></div><iframe id="printframe" title="Report preview"></iframe>`;
    document.body.appendChild(wrap);
    $("#pclose").onclick = () => wrap.remove();
    $("#pprint").onclick = () => $("#printframe").contentWindow.print();
  }
  $("#printframe").srcdoc = html;
}

/* ---------- backup gate ---------- */
async function backup() {
  const d = await inv("dashboard");
  DASH = d;
  applyHeader(d);
  let list = [];
  try { list = await inv("backup_list"); } catch (e) { /* teachers/viewers cannot list */ }
  const isAdmin = SESSION.role === "admin";
  const rows = list.map((b) => `<tr><td>${esc(b.id)}</td><td>${esc(b.created_at)}</td><td>${b.students}</td><td>${b.scores}</td><td>${b.reports}</td>
    <td class="mono">${esc(String(b.sha256 || "").slice(0, 16))}…</td>
    <td>${isAdmin ? `<button class="act ghost" onclick="doVerifyId('${jsq(b.id)}')">Verify</button>` : ""}</td></tr>`).join("");
  const gate = d.test_override
    ? `<div class="banner warn"><b>REAL DATA TEST MODE</b> — the production real-data gate was bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.</div>`
    : d.live
      ? `<div class="banner real"><b>REAL DATA MODE</b> — backups should be fresh before bulk changes and term locks.</div>`
      : `<div class="banner demo"><b>REAL-DATA GATE</b> — complete these steps before importing real students.</div>`;
  const demoRows = (d.students || 0) + (d.scores || 0) + (d.reports || 0);
  const testPanel = isAdmin && d.test_override_available && !d.live ? `
  <div class="card"><h2>Test-only real-data unlock</h2>
    <p class="muted small">This build is running in test mode (<code>AGM_TEST_ALLOW_REAL_DATA=1</code>). The override skips the verified-backup, drill and privacy checks, records your reason in the audit log, and shows a red TEST MODE banner on every screen. Use synthetic or explicitly authorized test data only; this is not a production approval.</p>
    <div class="actions"><button class="act danger" ${demoRows > 0 ? "disabled" : ""} onclick="doEnableRealTest()">Enable real data for testing</button></div>
    ${demoRows > 0 ? `<p class="warning small">Clear demo data first.</p>` : ""}
  </div>` : "";
  return `${gate}${testPanel}
  <div class="card"><h2>Backup &amp; restore gate</h2>
    <p>Backup verified: <b class="${d.backup_verified ? "ok" : "blocking"}">${d.backup_verified ? "yes" : "no"}</b> ·
       Drill passed: <b class="${d.drill_passed ? "ok" : "blocking"}">${d.drill_passed ? "yes" : "no"}</b> ·
       Privacy acknowledged: <b class="${d.privacy_ack ? "ok" : "blocking"}">${d.privacy_ack ? "yes" : "no"}</b> ·
       Mode: <b>${esc(d.data_mode)}</b></p>
    <p class="muted small">A backup is a full encrypted database snapshot. The drill opens it in a scratch database, checks the audit chain, and never touches live data.</p>
    ${isAdmin ? `<div class="actions">
      ${!d.live ? `<button class="act danger" ${d.students > 0 ? "" : "disabled"} onclick="doClearDemo()">0. Clear demo data</button>` : ""}
      <button class="act" onclick="doBackup()">1. Backup now</button>
      <button class="act ghost" onclick="doVerify()">2. Verify latest</button>
      <button class="act ghost" onclick="doDrill()">3. Run restore drill</button>
      ${!d.privacy_ack ? `<button class="act ghost" onclick="doPrivacy()">4. Acknowledge privacy notice</button>` : ""}
      <button class="act" ${d.backup_verified && d.drill_passed && d.privacy_ack && !d.live ? "" : "disabled"} onclick="doEnableReal()">5. Enable real data</button>
      <button class="act danger" onclick="doRestore()">Restore latest…</button>
    </div>` : `<p class="muted">Only an admin can create, verify, drill or restore backups.</p>`}
  </div>
  <div class="card"><h2>Backup history</h2>
    <table><tr><th>ID</th><th>Created</th><th>Students</th><th>Scores</th><th>Reports</th><th>SHA-256</th><th></th></tr>
    ${rows || "<tr><td colspan=7>No backups yet.</td></tr>"}</table>
    <p class="muted small">Copy the <code>.agm</code> and <code>.json</code> pair to a USB drive kept off-site. The files are encrypted; the manifest is not student data.</p>
  </div>`;
}

async function doClearDemo() {
  if (!confirm("Clear all demo students, scores and reports? Do this before enabling real data. This cannot be undone except by restoring a backup.")) return;
  if (!confirm("Second confirmation: clear demo data now?")) return;
  const r = await call("clear_demo", {}, null);
  if (r) { toast(r); DASH = null; render(); }
}
async function doBackup() {
  const r = await call("backup_create", {}, "Backup created and verified.");
  if (r) { DASH = null; render(); }
}
async function doVerify() {
  const r = await call("backup_verify", {}, null);
  if (r) toast(`Verified ${r.backup_id}: ${r.students} students, ${r.scores} scores, audit chain OK.`);
}
async function doVerifyId(id) {
  const r = await call("backup_verify", { backupId: id }, null);
  if (r) toast(`Verified ${r.backup_id}: ${r.students} students, ${r.scores} scores, audit chain OK.`);
}
async function doDrill() {
  const r = await call("drill_run", {}, null);
  if (r) { toast(r); DASH = null; render(); }
}
async function doPrivacy() {
  const r = await call("privacy_ack", {}, "Privacy notice acknowledged.");
  if (r) { DASH = null; render(); }
}
async function doEnableReal() {
  if (!confirm("Enable REAL DATA MODE? From this point the hub accepts real student data. Confirm the school authorization, privacy notice and staff training are in place.")) return;
  const r = await call("enable_real_mode", {}, null);
  if (r) { toast(r); DASH = null; render(); }
}
async function doEnableRealTest() {
  const reason = prompt("Reason for the test override (at least 12 characters). This is written to the audit log.");
  if (!reason || reason.trim().length < 12) {
    toast("A reason of at least 12 characters is required.");
    return;
  }
  if (!confirm("Enable REAL DATA TEST MODE? The production gate will be bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.")) return;
  const r = await call("enable_real_mode", { testOverrideReason: reason.trim() }, null);
  if (r) { toast(r); DASH = null; render(); }
}
async function doRestore() {
  if (!confirm("Restore the latest backup? The current database will be archived first. This replaces all data since that backup.")) return;
  if (!confirm("Second confirmation: restore now?")) return;
  const r = await call("restore_backup", {}, null);
  if (r) { toast(r); DASH = null; render(); }
}

/* ---------- users ---------- */
async function users() {
  if (SESSION.role !== "admin") return `<div class="card"><p class="muted">Admin only.</p></div>`;
  const list = await inv("users_list");
  const rows = list.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.role)}</td><td>${u.must_change ? "<b class='warning'>yes</b>" : "no"}</td><td>${esc(u.created_at)}</td>
    <td><button class="act ghost" onclick="doResetUser('${jsq(u.username)}')">Reset password</button>
    <button class="act danger" onclick="doRemoveUser('${jsq(u.username)}')">Remove</button></td></tr>`).join("");
  return `<div class="card"><h2>Staff accounts (${list.length})</h2>
    <p class="muted small">Roles are enforced in Rust. Admin cannot approve reports; Teacher and Head accounts must do that. Temporary passwords must be changed at first sign-in.</p>
    <table><tr><th>Username</th><th>Role</th><th>Must change</th><th>Created</th><th>Actions</th></tr>${rows}</table></div>
  <div class="card"><h2>Add a staff account</h2>
    <div class="actions">
      <input id="nu-user" placeholder="username" autocomplete="off">
      <select id="nu-role"><option value="teacher">Teacher</option><option value="head">Head</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
      <input id="nu-pass" type="password" placeholder="temporary password (12+)" autocomplete="new-password">
      <button class="act" onclick="doAddUser()">Add user</button>
    </div>
    <p class="muted small">Give the temporary password in person; the user must change it immediately.</p></div>`;
}

async function doAddUser() {
  const r = await call("user_add", {
    username: $("#nu-user").value.trim(),
    role: $("#nu-role").value,
    tempPassword: $("#nu-pass").value,
  }, "User added.");
  if (r) { $("#nu-user").value = ""; $("#nu-pass").value = ""; render(); }
}
async function doResetUser(username) {
  const p = prompt(`New temporary password for ${username} (12+ characters):`);
  if (!p) return;
  const r = await call("user_reset_password", { username, newPassword: p }, "Password reset.");
  if (r) render();
}
async function doRemoveUser(username) {
  if (!confirm(`Remove ${username}? They will no longer be able to unlock the hub.`)) return;
  const r = await call("user_remove", { username }, "User removed.");
  if (r) render();
}

/* ---------- account / audit ---------- */
async function account() {
  return `<div class="card"><h2>My account</h2>
    <p><b>${esc(SESSION.username)}</b> · ${esc(roleLabel(SESSION.role))}</p>
    <p class="muted small">Sessions lock automatically after 15 minutes of inactivity. Use Lock when leaving the PC.</p>
    <button class="act ghost" onclick="lockApp()">Lock now</button></div>
  <div class="card"><h2>Change password</h2>
    <form onsubmit="doChangePassword(event,true)">
      <label class="field">Current password<input id="ac-old" type="password" required autocomplete="current-password"></label>
      <label class="field">New password<input id="ac-new" type="password" minlength="12" required autocomplete="new-password"></label>
      <label class="field">Confirm new password<input id="ac-confirm" type="password" minlength="12" required autocomplete="new-password"></label>
      <button class="act" type="submit">Change password</button>
    </form></div>`;
}

async function audit() {
  const list = await inv("audit_list");
  const rows = list.map((a) => `<tr><td>${a.seq}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.entity)}</td></tr>`).join("");
  return `<div class="card"><h2>Audit trail (latest 200)</h2>
    <p class="muted small">Hash-chained, actor-bound, and encrypted at rest. The backup drill verifies the chain.</p>
    <table><tr><th>Seq</th><th>Actor</th><th>Action</th><th>Entity</th></tr>${rows}</table></div>`;
}

/* ---------- global bindings ---------- */
document.querySelectorAll("#nav button").forEach((b) => {
  b.onclick = () => go(b.dataset.s);
});
$("#lock-btn").onclick = () => lockApp();
document.addEventListener("pointerdown", resetIdle, true);
document.addEventListener("keydown", resetIdle, true);

boot();
