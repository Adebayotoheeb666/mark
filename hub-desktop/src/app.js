/* Agent Mark Hub console — vanilla JS over Tauri invoke. */
const inv = (...a) => window.__TAURI__.core.invoke(...a);
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let SEC = "dash";

function toast(msg, bad) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  t.style.background = bad ? "#7a1f1a" : "#10231b";
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.style.display = "none"), 4200);
}
async function call(fn, args, okMsg) {
  try { const r = await inv(fn, args || {}); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(String(e), true); throw e; }
}

document.querySelectorAll("#nav button").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("#nav button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    SEC = b.dataset.s;
    render();
  };
});

async function render() {
  const v = $("#view");
  v.innerHTML = "<div class='card'>Loading…</div>";
  try {
    if (SEC === "dash") return void (v.innerHTML = await dash());
    if (SEC === "students") return void (v.innerHTML = await students());
    if (SEC === "scores") return void (v.innerHTML = await scores());
    if (SEC === "flags") return void (v.innerHTML = await flags());
    if (SEC === "comments") return void (v.innerHTML = await comments());
    if (SEC === "reports") return void (v.innerHTML = await reports());
    if (SEC === "backup") return void (v.innerHTML = await backup());
    if (SEC === "audit") return void (v.innerHTML = await audit());
  } catch (e) { v.innerHTML = `<div class='card blocking'>${esc(e)}</div>`; }
  bind();
}
function bind() {}

/* ---------- Dashboard ---------- */
async function dash() {
  const d = await inv("dashboard");
  const school = await inv("school_get");
  $("#live-badge").innerHTML = d.live ? "<span class='pill live'>LIVE</span>" : "<span class='pill off'>NOT LIVE</span>";
  const block = d.blocking.map((b) => `<li class="blocking">${esc(b)}</li>`).join("") || "<li class='ok'>None — ready.</li>";
  const warn = d.warning.map((b) => `<li class="warning">${esc(b)}</li>`).join("") || "<li>None.</li>";
  return `<div class="grid">
    <div class="stat"><b>${d.students}</b><span>students</span></div>
    <div class="stat"><b>${d.scores}</b><span>scores</span></div>
    <div class="stat ${d.flags_open ? "warn" : ""}"><b>${d.flags_open}</b><span>open flags</span></div>
    <div class="stat"><b>${d.reports_locked}</b><span>locked reports</span></div>
    <div class="stat ${d.backup_verified ? "ok" : "bad"}"><b>${d.backup_verified ? "yes" : "no"}</b><span>backup verified</span></div>
    <div class="stat ${d.drill_passed ? "ok" : "bad"}"><b>${d.drill_passed ? "yes" : "no"}</b><span>drill passed</span></div>
  </div>
  <div class="card"><h2>Readiness checklist</h2><ul>${block}</ul><h2>Warnings</h2><ul>${warn}</ul>
  <div class="actions"><button class="act" onclick="doSeed()">Load demo school (6 students)</button>
  <button class="act ghost" onclick="doGoLive()">Go Live</button></div></div>
  <div class="card"><h2>School name</h2>
  <p class="muted" style="font-size:12px;margin:0 0 8px">Printed on every report card. Changes are written to the audit log.</p>
  <div class="actions"><input id="school-name" value="${esc(school)}" maxlength="80"
  style="flex:1;min-width:220px;padding:8px 10px;border:1px solid var(--line);border-radius:6px;font:inherit">
  <button class="act" onclick="doSchool()">Save name</button></div></div>`;
}
async function doSeed() { await call("seed_demo", {}, "Demo school loaded."); render(); }
async function doGoLive() { await call("go_live", {}, "Hub is LIVE."); render(); }
async function doSchool() {
  const v = $("#school-name").value;
  await call("school_set", { name: v, actor: "admin" }, "School name saved.");
  render();
}

/* ---------- Students ---------- */
async function students() {
  const list = await inv("students");
  const rows = list.map((s) => `<tr><td>${esc(s.short_code)}</td><td>${esc(s.first)} ${esc(s.last)}</td><td>${esc(s.class)}</td></tr>`).join("");
  return `<div class="card"><h2>Students (${list.length})</h2>
    <table><tr><th>Code</th><th>Name</th><th>Class</th></tr>${rows || "<tr><td colspan=3>No students — load demo or import.</td></tr>"}</table></div>
  <div class="card"><h2>CSV import (short_code,first_name,last_name,class_label + header)</h2>
    <textarea id="csv" rows="5" cols="70" placeholder="short_code,first_name,last_name,class_label&#10;26-JSS2A-007,Adaeze,Demo,JSS2-A"></textarea><br>
    <button class="act ghost" onclick="doImport(true)">Dry-run check</button>
    <button class="act" onclick="doImport(false)">Import for real</button>
    <div id="imp"></div></div>`;
}
async function doImport(dry) {
  const csv_text = $("#csv").value;
  const r = await call("roster_import", { csvText: csv_text, dryRun: dry });
  $("#imp").innerHTML = `<p>Would import: <b>${r.would_import}</b></p>` +
    (r.errors.length ? `<ul class="blocking">${r.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : "<p class='ok'>No errors.</p>");
  if (!dry && !r.errors.length) render();
}

/* ---------- Scores + results ---------- */
async function scores() {
  let res = [];
  try { res = await inv("results"); } catch (e) { /* weights gate */ }
  const rows = res.map((r) => {
    const m = r.subjects.MATHS ? `${r.subjects.MATHS.avg.toFixed(1)}%(${r.subjects.MATHS.grade})` : "—";
    const e = r.subjects.ENG ? `${r.subjects.ENG.avg.toFixed(1)}%(${r.subjects.ENG.grade})` : "—";
    return `<tr><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td>${m}</td><td>${e}</td><td>${r.overall.toFixed(1)}%</td><td>${r.position || "—"}</td></tr>`;
  }).join("");
  return `<div class="card"><h2>Enter score</h2>
    Student <input id="sc-stu" size="12" placeholder="26-JSS2A-001">
    Subject <select id="sc-sub"><option>MATHS</option><option>ENG</option></select>
    <span id="sc-labels"></span>
    Value <input id="sc-val" size="6" placeholder="17">
    <button class="act" onclick="doAdd()">Save</button>
    <small style="color:var(--mut)">Range-checked instantly (VAL-RANGE-01); conflicts refused (VAL-DUP-01).</small></div>
  <div class="card"><h2>Results (deterministic: same scores → same grades)</h2>
    <table><tr><th>Code</th><th>Name</th><th>MATHS</th><th>ENG</th><th>Overall</th><th>Pos</th></tr>${rows || "<tr><td colspan=6>No complete results yet.</td></tr>"}</table></div>
  <script>void 0<\/script>`;
}
function scoreLabels() {
  const subj = document.querySelector("#sc-sub")?.value || "MATHS";
  const labels = subj === "MATHS" ? ["CA1", "CA2", "Exam"] : ["CA", "Exam"];
  const maxs = subj === "MATHS" ? [20, 20, 60] : [40, 60];
  document.querySelector("#sc-labels").innerHTML =
    `Assessment <select id="sc-lab">${labels.map((l, i) => `<option value="${l}">${l} (max ${maxs[i]})</option>`).join("")}</select>`;
  document.querySelector("#sc-sub").onchange = scoreLabels;
}
async function doAdd() {
  await call("score_add", { student: $("#sc-stu").value.trim(), subject: $("#sc-sub").value, label: $("#sc-lab").value, value: parseFloat($("#sc-val").value), actor: "admin" }, "Score saved.");
  render();
}

/* ---------- Flags ---------- */
async function flags() {
  await inv("flags_scan").catch(() => {});
  const list = await inv("flags");
  const rows = list.map((f) => `<tr><td>${f.id}</td><td><span class="pill ${f.severity}">${f.severity}</span></td>
    <td>${esc(f.student_code)}</td><td>${esc(f.subject)} ${esc(f.label)}</td><td>${esc(f.rule_id)}</td><td>${esc(f.message)}</td>
    <td><button class="act ghost" onclick="doFlag('${f.id}','corrected')">Correct</button>
    <button class="act ghost" onclick="doFlagNote('${f.id}')">Confirm…</button>
    <button class="act ghost" onclick="doFlag('${f.id}','escalated')">Escalate</button></td></tr>`).join("");
  return `<div class="card"><h2>Flag inbox (${list.length} open) — blocking first</h2>
    <table><tr><th>ID</th><th>Severity</th><th>Student</th><th>Where</th><th>Rule</th><th>Message</th><th>Action</th></tr>
    ${rows || "<tr><td colspan=7 class='ok'>Inbox clear.</td></tr>"}</table>
    <p><small>Confirm requires a reason note. Nothing here ever auto-changes a score.</small></p></div>`;
}
async function doFlag(id, disp) {
  await call("flag_dispose", { id, disposition: disp, actor: "admin", note: disp === "corrected" ? "corrected at hub" : "escalated to head" }, `Flag ${id} ${disp}.`);
  render();
}
async function doFlagNote(id) {
  const note = prompt("Reason for confirming (required):");
  if (!note) return;
  await call("flag_dispose", { id, disposition: "confirmed", actor: "admin", note }, `Flag ${id} confirmed.`);
  render();
}

/* ---------- Comments ---------- */
async function comments() {
  const stus = await inv("students");
  const opts = stus.map((s) => `<option value="${s.short_code}">${esc(s.short_code)} ${esc(s.first)}</option>`).join("");
  return `<div class="card"><h2>Comment picker (3 taps + edit)</h2>
    Student <select id="c-stu">${opts}</select>
    Subject <select id="c-sub"><option>MATHS</option><option>ENG</option></select>
    Band <select id="c-band"><option>A</option><option>B</option><option>C</option><option>D</option><option>F</option></select>
    <button class="act ghost" onclick="doPick()">Show sentences</button>
    <div id="c-list"></div>
    <div id="c-prev"></div></div>`;
}
async function doPick() {
  const list = await call("comment_pick", { subject: $("#c-sub").value, band: $("#c-band").value });
  $("#c-list").innerHTML = list.map((t) => `<p><button class="act ghost" onclick="doPrev('${t.id}')">Use</button> <small>${t.id}</small> ${esc(t.text)}</p>`).join("") || "<p>No templates.</p>";
}
async function doPrev(tid) {
  const p = await call("comment_preview", { templateId: tid, ctx: { name: $("#c-stu").value, subject: $("#c-sub").value, score: "—", strength: "problem solving", next_step: "daily practice" } });
  $("#c-prev").innerHTML = `<textarea id="c-text" rows="3" cols="80">${esc(p.text)}</textarea><br>
    <small>${p.chars}/210 ${p.blocked ? "<b class='blocking'>TOO LONG</b>" : ""}</small><br>
    <button class="act" onclick="doSaveComment('${tid}')">Save comment for ${esc($("#c-stu").value)}</button>`;
}
async function doSaveComment(tid) {
  await call("comment_save", { student: $("#c-stu").value, subject: $("#c-sub").value, term: "1T-26", templateId: tid, text: $("#c-text").value, author: "admin" }, "Comment saved.");
}

/* ---------- Reports ---------- */
async function reports() {
  const list = await inv("reports");
  const rows = list.map((r) => `<tr><td>${r.id}</td><td>${esc(r.student_code)}</td><td>v${r.version}</td><td>${r.status}</td><td>${esc(r.approvals)}</td>
    <td>${r.status === "draft" ? `<button class="act ghost" onclick="doAppr('${r.id}','teacher')">Teacher ✓</button>` : ""}
    ${r.status === "reviewed" ? `<button class="act ghost" onclick="doAppr('${r.id}','head')">Head ✓</button> <button class="act" onclick="doLock('${r.id}')">Lock+Sign</button>` : ""}
    <button class="act ghost" onclick="doView('${r.id}')">View</button></td></tr>`).join("");
  return `<div class="card"><h2>Reports (${list.length})</h2>
    <button class="act" onclick="doDraftAll()">Draft all complete students (term 2026-T1)</button>
    <table><tr><th>ID</th><th>Student</th><th>Ver</th><th>Status</th><th>Approvals</th><th>Action</th></tr>${rows || "<tr><td colspan=6>No drafts yet.</td></tr>"}</table>
    <div id="repview"></div></div>`;
}
async function doDraftAll() { const n = await call("reports_draft_all", { term: "1T-26" }, "Drafts created."); render(); }
async function doAppr(id, role) { await call("report_approve", { id, role, by: role === "teacher" ? "Mrs. Ade" : "Mr. Head" }, `${role} approved.`); render(); }
async function doLock(id) { const qr = await call("report_lock", { id, by: "Mr. Head" }, "Locked + signed."); alert("QR/signature:\n" + qr); render(); }
async function doView(id) {
  const html = await call("report_html", { id });
  // Render inside an in-app overlay: `window.open` is unreliable inside WebView2 and a
  // separate window would not inherit the app's print/preview context.
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

/* ---------- Backup ---------- */
async function backup() {
  const d = await inv("dashboard");
  return `<div class="card"><h2>Backup &amp; restore drill (hard gate)</h2>
    <p>Backup verified: <b>${d.backup_verified ? "yes" : "no"}</b> · Drill passed: <b>${d.drill_passed ? "yes" : "no"}</b> · Live: <b>${d.live ? "yes" : "no"}</b></p>
    <p><small>Backups are XChaCha20-Poly1305 encrypted with the school-held key. Go-Live stays blocked until both are yes.</small></p>
    <button class="act" onclick="doBackup()">1. Backup now (encrypted)</button>
    <button class="act" onclick="doDrill()">2. Run restore drill</button>
    <button class="act ghost" onclick="doGoLive()">3. Go Live</button></div>`;
}
async function doBackup() { await call("backup_create", {}, "Backup complete."); render(); }
async function doDrill() { await call("drill_run", {}, "Drill PASS."); render(); }

/* ---------- Audit ---------- */
async function audit() {
  const rows = await inv("audit_list");
  return `<div class="card"><h2>Audit log (hash-chained, latest 200)</h2>
    <table><tr><th>#</th><th>Actor</th><th>Action</th><th>Entity</th></tr>
    ${rows.map((r) => `<tr><td>${r.seq}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.entity)}</td></tr>`).join("")}</table></div>`;
}

if (!window.__TAURI__) {
  $("#view").innerHTML = "<div class='card blocking'>This console must run inside the Tauri desktop app (it calls the local Rust backend). Run <code>.\\build.ps1</code> in <code>hub-desktop</code> and launch the .exe.</div>";
} else {
  render();
  new MutationObserver(() => { if (document.querySelector("#sc-sub") && !document.querySelector("#sc-lab")) scoreLabels(); }).observe(document.querySelector("#view"), { childList: true, subtree: true });
}
