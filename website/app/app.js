/* Agent Mark — mobile companion (offline PWA).
 *
 * Deterministic only: same assessment weights, grade bands and competition rank as the
 * desktop hub. Data lives in localStorage on this phone. There is no fetch(), no sync,
 * no analytics and no AI.
 */
(function () {
  "use strict";

  var KEY = "agentmark.mobile.v1";
  var VERSION = "0.1.0";

  var ASSESS = [
    { subject: "MATHS", label: "CA1", max: 20, weight: 20 },
    { subject: "MATHS", label: "CA2", max: 20, weight: 20 },
    { subject: "MATHS", label: "Exam", max: 60, weight: 60 },
    { subject: "ENG", label: "CA", max: 40, weight: 40 },
    { subject: "ENG", label: "Exam", max: 60, weight: 60 }
  ];
  var SUBJECTS = ["MATHS", "ENG"];
  var SUBJECT_NAME = { MATHS: "Mathematics", ENG: "English" };
  var DEMO = [
    ["26-JSS2A-001", "Ada", "JSS 2A"],
    ["26-JSS2A-002", "Bola", "JSS 2A"],
    ["26-JSS2A-003", "Chidi", "JSS 2A"],
    ["26-JSS2A-004", "Dola", "JSS 2A"],
    ["26-JSS2A-005", "Emeka", "JSS 2A"],
    ["26-JSS2A-006", "Funmi", "JSS 2A"]
  ];

  // ---------- state ----------
  function demoState() {
    return {
      version: 1,
      term: "2026-T1",
      students: DEMO.map(function (r) { return { code: r[0], name: r[1], cls: r[2] }; }),
      scores: {}
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return demoState();
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.students)) return demoState();
      return s;
    } catch (e) {
      return demoState();
    }
  }

  var S = load();
  var ui = { tab: "home", student: null, subject: "MATHS" };

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* quota */ }
  }

  // ---------- rules ----------
  function skey(code, subject, label) { return code + "|" + subject + "|" + label; }

  function getScore(code, subject, label) {
    var rec = S.scores[skey(code, subject, label)];
    return rec ? rec.v : null;
  }

  // Weighted average in tenths: sum(value/max * weight * 10), rounded half up.
  function weightedTenths(parts) {
    var acc = 0;
    for (var i = 0; i < parts.length; i++) {
      acc += (parts[i].v / parts[i].max) * parts[i].weight * 10;
    }
    return Math.floor(acc + 0.5);
  }

  // CALC-GRADE-01: A >= 70, B >= 60, C >= 50, D >= 45, E >= 40, else F.
  function gradeOf(t) {
    if (t >= 700) return "A";
    if (t >= 600) return "B";
    if (t >= 500) return "C";
    if (t >= 450) return "D";
    if (t >= 400) return "E";
    return "F";
  }

  function subjectResult(code, subject) {
    var parts = [];
    var missing = [];
    ASSESS.forEach(function (a) {
      if (a.subject !== subject) return;
      var v = getScore(code, subject, a.label);
      if (v === null) missing.push(a.label);
      else parts.push({ v: v, max: a.max, weight: a.weight });
    });
    if (missing.length) return { missing: missing, complete: false };
    if (!parts.length) return { missing: [], complete: false };
    var t = weightedTenths(parts);
    var total = parts.reduce(function (n, p) { return n + p.v; }, 0);
    return { complete: true, tenths: t, avg: t / 10, grade: gradeOf(t), total: total };
  }

  function studentResult(code) {
    var subjects = {};
    var sum = 0, n = 0;
    SUBJECTS.forEach(function (subj) {
      var r = subjectResult(code, subj);
      subjects[subj] = r;
      if (r.complete) { sum += r.avg; n += 1; }
    });
    var overall = n ? sum / n : null;
    return {
      subjects: subjects,
      overall: overall,
      overallTenths: overall === null ? null : Math.round(overall * 10),
      complete: n === SUBJECTS.length
    };
  }

  function allFlags() {
    var out = [];
    S.students.forEach(function (st) {
      SUBJECTS.forEach(function (subj) {
        var r = subjectResult(st.code, subj);
        (r.missing || []).forEach(function (label) {
          out.push({ code: st.code, name: st.name, subject: subj, label: label });
        });
      });
    });
    return out;
  }

  function rankMap() {
    var rows = S.students.map(function (st) {
      return { code: st.code, t: studentResult(st.code).overallTenths };
    }).filter(function (r) { return r.t !== null; });
    var map = {};
    rows.forEach(function (r) {
      map[r.code] = 1 + rows.filter(function (o) { return o.t > r.t; }).length;
    });
    return map;
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function student(code) {
    return S.students.filter(function (s) { return s.code === code; })[0] || null;
  }
  function recordedCount() { return Object.keys(S.scores).length; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // ---------- views ----------
  function viewHome() {
    var flags = allFlags();
    var ready = S.students.filter(function (st) { return studentResult(st.code).complete; }).length;
    var scored = recordedCount();
    var expected = S.students.length * ASSESS.length;
    var checks = [
      { ok: S.students.length > 0, title: "Roster loaded", note: S.students.length + " students" },
      { ok: scored > 0, title: "Scores captured", note: scored + " of " + expected + " marks" },
      { ok: flags.length === 0, title: "No missing marks", note: flags.length ? flags.length + " missing — open the Flags tab" : "all assessments complete" },
      { ok: ready > 0, title: "A card can be previewed", note: ready + " student" + (ready === 1 ? "" : "s") + " complete" }
    ];

    return '' +
      '<div class="card hero-card">' +
        '<div class="term">' + esc(S.term) + ' · JSS 2A</div>' +
        '<h1>Good day.</h1>' +
        '<p>Capture marks on this phone, check them against the rules, and preview a card. Nothing is uploaded.</p>' +
      '</div>' +
      '<div class="stats">' +
        '<div class="stat"><b>' + S.students.length + '</b><span>students</span></div>' +
        '<div class="stat"><b>' + scored + '</b><span>marks recorded</span></div>' +
        '<div class="stat ' + (flags.length ? "warn" : "") + '"><b>' + flags.length + '</b><span>missing marks</span></div>' +
        '<div class="stat"><b>' + ready + '</b><span>cards ready</span></div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Readiness</h2>' +
        '<ul class="checklist">' +
          checks.map(function (c) {
            return '<li><span class="mark ' + (c.ok ? "ok" : "no") + '">' + (c.ok ? "✓" : "!") + '</span>' +
              '<div><b>' + esc(c.title) + '</b><small>' + esc(c.note) + '</small></div></li>';
          }).join("") +
        '</ul>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Next</h2>' +
        '<div class="stack">' +
          '<button class="btn" data-go="scores">Enter scores</button>' +
          '<button class="btn secondary" data-go="card">Preview a report card</button>' +
          '<button class="btn secondary" data-go="flags">Review missing marks</button>' +
        '</div>' +
      '</div>' +
      '<p class="tiny muted" style="text-align:center">Companion preview · data stays on this device</p>';
  }

  function viewScores() {
    if (!S.students.length) {
      return '<h1>Enter scores</h1><div class="card"><div class="empty"><span class="big">∅</span>' +
        'No students yet. Import a roster file from the More tab.</div></div>';
    }
    var st = student(ui.student) || S.students[0];
    if (st) ui.student = st.code;
    var rows = ASSESS.filter(function (a) { return a.subject === ui.subject; });
    return '' +
      '<h1>Enter scores</h1>' +
      '<p class="small muted" style="margin-top:-.3rem">Range and duplicate checks run on save. A saved mark is never silently replaced.</p>' +
      '<label class="field"><span>Student</span><select id="f-student">' +
        S.students.map(function (s) {
          return '<option value="' + esc(s.code) + '"' + (s.code === ui.student ? " selected" : "") + '>' +
            esc(s.name) + " · " + esc(s.code) + '</option>';
        }).join("") +
      '</select></label>' +
      '<div class="seg" role="tablist">' +
        SUBJECTS.map(function (subj) {
          return '<button data-subject="' + subj + '" class="' + (subj === ui.subject ? "on" : "") + '">' +
            SUBJECT_NAME[subj] + '</button>';
        }).join("") +
      '</div>' +
      '<div class="card tight">' +
        rows.map(function (a) {
          var v = getScore(ui.student, a.subject, a.label);
          return '<div class="score-row">' +
            '<div class="label">' + esc(a.label) + '<small>out of ' + a.max + ' · weight ' + a.weight + '%</small></div>' +
            '<div><input type="number" inputmode="decimal" min="0" max="' + a.max + '" step="1" ' +
              'data-label="' + esc(a.label) + '" value="' + (v === null ? "" : v) + '" placeholder="—">' +
              (v === null ? "" : '<div class="saved">saved</div>') +
            '</div>' +
          '</div>';
        }).join("") +
      '</div>' +
      '<div id="score-msg"></div>' +
      '<button class="btn" id="save-scores">Save ' + SUBJECT_NAME[ui.subject] + ' scores</button>' +
      '<div class="card tight" style="margin-top:.8rem">' +
        '<div class="row"><span class="small muted">Subject average</span><b id="subject-avg">—</b></div>' +
      '</div>';
  }

  function viewFlags() {
    var flags = allFlags();
    if (!flags.length) {
      return '<h1>Flags</h1><div class="card"><div class="empty"><span class="big">✓</span>' +
        'No missing marks. Every student has all five assessments.</div></div>';
    }
    var byStudent = {};
    flags.forEach(function (f) {
      (byStudent[f.code] = byStudent[f.code] || []).push(f);
    });
    return '<h1>Flags</h1>' +
      '<p class="small muted" style="margin-top:-.3rem">' + flags.length + ' missing marks. Tap one to enter it. Flags never change a score.</p>' +
      Object.keys(byStudent).map(function (code) {
        var list = byStudent[code];
        return '<div class="card tight">' +
          '<div class="row" style="margin-bottom:.2rem"><b>' + esc(list[0].name) + '</b>' +
          '<span class="pill amber">' + list.length + '</span></div>' +
          list.map(function (f) {
            return '<button class="flag" style="width:100%;background:none;border:0;border-bottom:1px solid #f0ece2;text-align:left;cursor:pointer" ' +
              'data-jump="' + esc(f.code) + '|' + f.subject + '|' + esc(f.label) + '">' +
              '<span class="sev"></span><span style="flex:1">' +
                '<b>' + esc(SUBJECT_NAME[f.subject]) + ' · ' + esc(f.label) + '</b>' +
                '<p><span class="code">VAL-MISS-01</span> — no mark recorded</p>' +
              '</span><span class="muted">›</span></button>';
          }).join("") +
        '</div>';
      }).join("");
  }

  function viewCard() {
    if (!S.students.length) {
      return '<h1>Report card</h1><div class="card"><div class="empty"><span class="big">∅</span>' +
        'No students yet. Import a roster file from the More tab.</div></div>';
    }
    var st = student(ui.student) || S.students[0];
    if (st) ui.student = st.code;
    var r = studentResult(ui.student);
    var pos = rankMap()[ui.student];
    var rows = SUBJECTS.map(function (subj) {
      var s = r.subjects[subj];
      if (!s.complete) {
        return '<tr><td>' + SUBJECT_NAME[subj] + '</td><td class="muted">—</td><td class="muted">' +
          (s.missing.length ? s.missing.length + ' missing' : '—') + '</td><td class="muted">—</td></tr>';
      }
      return '<tr><td>' + SUBJECT_NAME[subj] + '</td><td>' + s.total + '</td>' +
        '<td>' + s.avg.toFixed(1) + '</td>' +
        '<td><span class="grade ' + s.grade.toLowerCase() + '">' + s.grade + '</span></td></tr>';
    }).join("");

    return '<h1>Report card</h1>' +
      '<label class="field no-print"><span>Student</span><select id="f-card-student">' +
        S.students.map(function (s) {
          return '<option value="' + esc(s.code) + '"' + (s.code === ui.student ? " selected" : "") + '>' +
            esc(s.name) + " · " + esc(s.code) + '</option>';
        }).join("") +
      '</select></label>' +
      '<div class="card tight">' +
        '<div class="sheet">' +
          '<div class="draftbar">DRAFT — NOT OFFICIAL</div>' +
          '<div class="sheet-head">' +
            '<div><b>Greenfield Secondary School</b><small>Terminal report · ' + esc(S.term) + '</small></div>' +
            '<div style="text-align:right"><small>' + esc(st ? st.cls : "") + '</small><small>' + esc(st ? st.code : "") + '</small></div>' +
          '</div>' +
          '<div style="margin-bottom:.4rem"><b>' + esc(st ? st.name : "") + '</b></div>' +
          '<table><thead><tr><th>Subject</th><th>Total</th><th>Avg</th><th>Grade</th></tr></thead><tbody>' +
            rows +
            '<tr class="total"><td>Overall</td><td></td><td>' + (r.overall === null ? "—" : r.overall.toFixed(1)) + '</td>' +
            '<td>' + (r.overallTenths === null ? "—" : '<span class="grade ' + gradeOf(r.overallTenths).toLowerCase() + '">' + gradeOf(r.overallTenths) + '</span>') + '</td></tr>' +
          '</tbody></table>' +
          '<div class="sheet-foot"><span>Position ' + (pos || "—") + ' of ' + S.students.length + '</span>' +
            '<span>Preview only · not signed</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="stack no-print" style="margin-top:.7rem">' +
        '<button class="btn secondary" id="print-card">Print / save as PDF</button>' +
      '</div>' +
      '<p class="tiny muted no-print">The phone app cannot approve or sign. Locked, signed cards come from the desktop hub.</p>';
  }

  function viewMore() {
    var used = 0;
    try { used = (localStorage.getItem(KEY) || "").length; } catch (e) {}
    return '<h1>More</h1>' +
      '<div class="card">' +
        '<h2>This device</h2>' +
        '<div class="row small"><span class="muted">Data stored</span><span>' + (used / 1024).toFixed(1) + ' KB</span></div>' +
        '<div class="row small"><span class="muted">Students</span><span>' + S.students.length + '</span></div>' +
        '<div class="row small"><span class="muted">Marks</span><span>' + recordedCount() + '</span></div>' +
        '<div class="row small"><span class="muted">Version</span><span>' + VERSION + '</span></div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Backup this phone</h2>' +
        '<p class="small muted">Exports a JSON file with this demo data. It is not encrypted — treat it like a mark book page.</p>' +
        '<div class="stack">' +
          '<button class="btn" id="export-json">Export data</button>' +
          '<button class="btn secondary" id="import-json">Import data</button>' +
          '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>The full hub</h2>' +
        '<p class="small muted">The authoritative records, approvals, signatures and backups live on the school PC.</p>' +
        '<div class="stack">' +
          '<a class="btn secondary" href="../download.html">Download the desktop app</a>' +
          '<a class="btn secondary" href="../install.html">Install guide</a>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Privacy</h2>' +
        '<p class="small muted">This app makes no network requests. It has no account, no sync and no AI. Clearing the browser data removes everything it holds.</p>' +
        '<button class="btn danger" id="reset-demo">Reset to demo data</button>' +
      '</div>' +
      '<p class="tiny muted" style="text-align:center">Agent Mark ' + VERSION + ' · pilot preview · synthetic data only</p>';
  }

  // ---------- render ----------
  var VIEWS = { home: viewHome, scores: viewScores, flags: viewFlags, card: viewCard, more: viewMore };

  function render() {
    var root = $("#view");
    root.innerHTML = VIEWS[ui.tab]();
    $$(".tabbar button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === ui.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    wire();
    window.scrollTo(0, 0);
  }

  function go(tab) { ui.tab = tab; render(); }

  function wire() {
    $$("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-go")); });
    });

    var fs = $("#f-student");
    if (fs) fs.addEventListener("change", function () { ui.student = fs.value; render(); });

    $$("[data-subject]").forEach(function (b) {
      b.addEventListener("click", function () { ui.subject = b.getAttribute("data-subject"); render(); });
    });

    var saveBtn = $("#save-scores");
    if (saveBtn) saveBtn.addEventListener("click", onSaveScores);

    $$("[data-jump]").forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.getAttribute("data-jump").split("|");
        ui.student = parts[0];
        ui.subject = parts[1];
        go("scores");
      });
    });

    var fc = $("#f-card-student");
    if (fc) fc.addEventListener("change", function () { ui.student = fc.value; render(); });

    var pc = $("#print-card");
    if (pc) pc.addEventListener("click", function () { window.print(); });

    var ex = $("#export-json");
    if (ex) ex.addEventListener("click", onExport);

    var im = $("#import-json");
    var file = $("#import-file");
    if (im && file) {
      im.addEventListener("click", function () { file.click(); });
      file.addEventListener("change", onImport);
    }

    var rs = $("#reset-demo");
    if (rs) rs.addEventListener("click", function () {
      if (!confirm("Replace everything on this phone with the six demo students?")) return;
      S = demoState();
      save();
      go("home");
    });

    $$("#view input[data-label]").forEach(function (inp) {
      inp.addEventListener("input", updateAverage);
    });

    updateAverage();
  }

  function updateAverage() {
    var el = $("#subject-avg");
    if (!el) return;
    // Prefer what is currently typed so the figure moves as the teacher enters marks.
    var inputs = $$("#view input[data-label]");
    if (inputs.length) {
      var parts = [];
      var missing = 0;
      inputs.forEach(function (inp) {
        var label = inp.getAttribute("data-label");
        var def = ASSESS.filter(function (a) { return a.subject === ui.subject && a.label === label; })[0];
        var raw = inp.value.trim();
        if (raw === "") { missing += 1; return; }
        var v = Number(raw);
        if (!isFinite(v) || v < 0 || v > def.max) { missing += 1; return; }
        parts.push({ v: v, max: def.max, weight: def.weight });
      });
      if (missing || parts.length !== inputs.length) { el.textContent = "incomplete"; return; }
      var t = weightedTenths(parts);
      el.textContent = (t / 10).toFixed(1) + " · " + gradeOf(t);
      return;
    }
    var r = subjectResult(ui.student, ui.subject);
    el.textContent = r.complete ? r.avg.toFixed(1) + " · " + r.grade : "incomplete";
  }

  // ---------- actions ----------
  function message(text, kind) {
    var box = $("#score-msg");
    if (!box) return;
    box.innerHTML = text ? '<div class="msg ' + (kind || "ok") + '">' + esc(text) + '</div>' : "";
  }

  function onSaveScores() {
    var inputs = $$("#view input[data-label]");
    var writes = [];
    var errors = [];

    inputs.forEach(function (inp) {
      var label = inp.getAttribute("data-label");
      var def = ASSESS.filter(function (a) { return a.subject === ui.subject && a.label === label; })[0];
      var raw = inp.value.trim();
      if (raw === "") {
        // An emptied field clears the mark only if one existed.
        if (getScore(ui.student, ui.subject, label) !== null) writes.push({ label: label, value: null });
        return;
      }
      var v = Number(raw);
      if (!isFinite(v) || Math.floor(v) !== v) { errors.push(label + ": enter a whole number"); return; }
      if (v < 0 || v > def.max) { errors.push("VAL-RANGE-01: " + label + " must be between 0 and " + def.max); return; }
      var old = getScore(ui.student, ui.subject, label);
      if (old !== null && old !== v) {
        errors.push("VAL-DUP-01: " + label + " already has " + old + ". Clear the field first if you mean to replace it.");
        return;
      }
      if (old === null) writes.push({ label: label, value: v });
    });

    if (errors.length) { message(errors.join(" · "), "err"); return; }

    var cleared = writes.filter(function (w) { return w.value === null; }).length;
    writes.forEach(function (w) {
      var k = skey(ui.student, ui.subject, w.label);
      if (w.value === null) delete S.scores[k];
      else S.scores[k] = { v: w.value, at: new Date().toISOString() };
    });
    save();
    render();
    message(writes.length ? "Saved " + (writes.length - cleared) + " mark" + (writes.length - cleared === 1 ? "" : "s") + (cleared ? " and cleared " + cleared : "") + "." : "Nothing to save.", writes.length ? "ok" : "warn");
  }

  function onExport() {
    var blob = new Blob([JSON.stringify(S, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "agent-mark-mobile-" + S.term + ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function onImport(ev) {
    var f = ev.target.files && ev.target.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.students) || typeof data.scores !== "object") throw new Error("bad shape");
        S = { version: 1, term: data.term || "2026-T1", students: data.students, scores: data.scores };
        save();
        ui.student = null;
        go("home");
      } catch (e) {
        alert("That file is not an Agent Mark mobile export.");
      }
    };
    reader.readAsText(f);
    ev.target.value = "";
  }

  // ---------- chrome ----------
  function chrome() {
    $$(".tabbar button").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-tab")); });
    });

    function net() {
      var el = $("#conn");
      if (!el) return;
      var on = navigator.onLine;
      el.classList.toggle("off", !on);
      el.querySelector("span:last-child").textContent = on ? "offline-ready" : "offline";
    }
    window.addEventListener("online", net);
    window.addEventListener("offline", net);
    net();

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () { /* file:// or unsupported */ });
      });
    }

    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      var b = $("#install");
      if (b) b.hidden = false;
    });
    var ib = $("#install");
    if (ib) ib.addEventListener("click", async function () {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      ib.hidden = true;
    });
  }

  chrome();
  render();
})();
