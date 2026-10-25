/* Agent Mark — mobile companion (offline PWA).
 *
 * Deterministic only: same assessment weights, grade bands and competition rank as the
 * desktop hub. Student data is encrypted on this device with a passcode (PBKDF2-SHA-256
 * + AES-256-GCM). There is no fetch(), no sync, no analytics and no AI.
 */
(function () {
  "use strict";

  var KEY = "agentmark.mobile.v2";
  var LEGACY_KEY = "agentmark.mobile.v1";
  var LOCK_KEY = "agentmark.mobile.lock";
  var PREF_KEY = "agentmark.mobile.prefs";
  var VERSION = "0.2.0";
  var ITER = 310000;
  var AAD = "AGM-MOBILE-V2";
  var TRANSFER_MAGIC = "AGMMOB01";
  var TRANSFER_AAD = "AGM-MOBILE-TRANSFER-V1";
  var MIN_PASS = 8;
  var MIN_TRANSFER = 12;

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

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  // ---------- state ----------
  function demoState(school) {
    return {
      version: 2,
      school_name: school || "Greenfield Secondary School",
      term: "2026-T1",
      data_mode: "demo",
      privacy_ack: false,
      transfer_export_at: null,
      students: DEMO.map(function (r) { return { code: r[0], name: r[1], cls: r[2] }; }),
      scores: {}
    };
  }

  var S = null;              // decrypted state, only while unlocked
  var SESSION = null;        // { key: CryptoKey, salt: Uint8Array, iter: number }
  var ENVELOPE = null;       // encrypted envelope read from localStorage
  var ui = { tab: "home", student: null, subject: "MATHS" };
  var lastActivity = Date.now();

  function prefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      return { autoLockMin: [1, 5, 15, 30].indexOf(Number(p.autoLockMin)) >= 0 ? Number(p.autoLockMin) : 5 };
    } catch (e) {
      return { autoLockMin: 5 };
    }
  }
  function savePrefs(p) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* quota */ }
  }

  function readEnvelope() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var env = JSON.parse(raw);
      if (!env || env.v !== 2 || !env.salt || !env.iv || !env.ct) return null;
      return env;
    } catch (e) {
      return null;
    }
  }

  function readLegacy() {
    try {
      var raw = localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.students)) return null;
      return {
        version: 2,
        school_name: "Greenfield Secondary School",
        term: s.term || "2026-T1",
        data_mode: "demo",
        privacy_ack: false,
        transfer_export_at: null,
        students: s.students.map(function (x) { return { code: x.code, name: x.name, cls: x.cls }; }),
        scores: s.scores || {}
      };
    } catch (e) {
      return null;
    }
  }

  function loadLock() {
    try {
      var m = JSON.parse(localStorage.getItem(LOCK_KEY) || "{}");
      return { failures: Number(m.failures) || 0, until: Number(m.until) || 0 };
    } catch (e) {
      return { failures: 0, until: 0 };
    }
  }
  function saveLock(m) {
    try { localStorage.setItem(LOCK_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
  }

  // ---------- crypto ----------
  function bytesToB64(buf) {
    var b = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s);
  }
  function b64ToBytes(s) {
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function concatBytes(parts) {
    var len = parts.reduce(function (n, p) { return n + p.length; }, 0);
    var out = new Uint8Array(len);
    var off = 0;
    parts.forEach(function (p) { out.set(p, off); off += p.length; });
    return out;
  }

  async function deriveKey(pass, salt, iter) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("This browser does not expose WebCrypto. Use Chrome/Edge or the installed app.");
    }
    var base = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: iter, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function sealWithKey(state, key, salt, iter, created) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: enc.encode(AAD), tagLength: 128 },
      key,
      enc.encode(JSON.stringify(state))
    );
    var now = new Date().toISOString();
    return {
      v: 2,
      kdf: "PBKDF2-SHA-256",
      iter: iter,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ct: bytesToB64(ct),
      created: created || now,
      updated: now
    };
  }

  async function sealWithPass(state, pass, salt, iter, created) {
    var s = salt || crypto.getRandomValues(new Uint8Array(16));
    var key = await deriveKey(pass, s, iter);
    var env = await sealWithKey(state, key, s, iter, created);
    return { env: env, key: key, salt: s, iter: iter };
  }

  async function openEnvelope(env, pass) {
    var salt = b64ToBytes(env.salt);
    var key = await deriveKey(pass, salt, env.iter || ITER);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(env.iv), additionalData: enc.encode(AAD), tagLength: 128 },
      key,
      b64ToBytes(env.ct)
    );
    var state = JSON.parse(dec.decode(plain));
    if (!state || !Array.isArray(state.students) || typeof state.scores !== "object") {
      throw new Error("The encrypted store is not a valid Agent Mark state.");
    }
    return { state: state, key: key, salt: salt, iter: env.iter || ITER };
  }

  async function save() {
    if (!S || !SESSION) throw new Error("The app is locked.");
    var env = await sealWithKey(S, SESSION.key, SESSION.salt, SESSION.iter, ENVELOPE && ENVELOPE.created);
    localStorage.setItem(KEY, JSON.stringify(env));
    ENVELOPE = env;
  }

  // ---------- transfer format ----------
  async function sealTransfer(payload, pass) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var key = await deriveKey(pass, salt, ITER);
    var ct = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: enc.encode(TRANSFER_AAD), tagLength: 128 },
      key,
      enc.encode(JSON.stringify(payload))
    );
    return concatBytes([enc.encode(TRANSFER_MAGIC), salt, iv, new Uint8Array(ct)]);
  }

  async function openTransfer(bytes, pass) {
    if (bytes.length < 8 + 16 + 12 + 16) throw new Error("That file is too short to be an Agent Mark export.");
    var magic = dec.decode(bytes.slice(0, 8));
    if (magic !== TRANSFER_MAGIC) throw new Error("That file is not an Agent Mark encrypted export.");
    var salt = bytes.slice(8, 24);
    var iv = bytes.slice(24, 36);
    var ct = bytes.slice(36);
    var key = await deriveKey(pass, salt, ITER);
    var plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv, additionalData: enc.encode(TRANSFER_AAD), tagLength: 128 },
      key,
      ct
    );
    var payload = JSON.parse(dec.decode(plain));
    if (!payload || !Array.isArray(payload.students) || typeof payload.scores !== "object") {
      throw new Error("The encrypted export is missing its roster or scores.");
    }
    return payload;
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
  function touch() { lastActivity = Date.now(); }
  function nowLabel(iso) {
    if (!iso) return "never";
    try { return new Date(iso).toLocaleString(); } catch (e) { return iso; }
  }

  // ---------- auth screens ----------
  function auth(html) {
    document.body.classList.add("locked");
    var el = $("#auth");
    if (el) el.innerHTML = html;
    var lock = $("#lock");
    if (lock) lock.hidden = true;
  }

  function showSetup() {
    var legacy = readLegacy();
    auth('' +
      '<div class="auth-card">' +
        '<div class="brand">Agent Mark</div>' +
        '<h2>Set up this phone</h2>' +
        '<p class="small muted">This creates an encrypted store on this device. There is no account and no cloud. ' +
          'If you forget the passcode, the data on this phone cannot be recovered — export an encrypted copy regularly.</p>' +
        (legacy ? '<div class="notice"><strong>Legacy demo data found.</strong> It will be encrypted and kept.</div>' : '') +
        '<form id="setup-form">' +
          '<label class="field"><span>School name</span><input id="su-school" maxlength="80" required placeholder="e.g. Greenfield Secondary School"></label>' +
          '<label class="field"><span>Passcode</span><input id="su-pass" type="password" minlength="' + MIN_PASS + '" required autocomplete="new-password" placeholder="' + MIN_PASS + '+ characters"></label>' +
          '<label class="field"><span>Confirm passcode</span><input id="su-confirm" type="password" minlength="' + MIN_PASS + '" required autocomplete="new-password"></label>' +
          '<div id="auth-err" class="auth-err"></div>' +
          '<button class="btn" type="submit">Create encrypted store</button>' +
        '</form>' +
        '<p class="tiny muted" style="text-align:center">PBKDF2-SHA-256 · AES-256-GCM · no network</p>' +
      '</div>');
    $("#setup-form").addEventListener("submit", doSetup);
    $("#su-school").value = legacy ? legacy.school_name : "";
  }

  async function doSetup(ev) {
    ev.preventDefault();
    var school = $("#su-school").value.trim();
    var pass = $("#su-pass").value;
    var confirm = $("#su-confirm").value;
    var err = $("#auth-err");
    if (!school) { err.textContent = "Enter the school name."; return; }
    if (pass.length < MIN_PASS) { err.textContent = "Use at least " + MIN_PASS + " characters."; return; }
    if (pass !== confirm) { err.textContent = "The passcodes do not match."; return; }
    err.textContent = "Encrypting…";
    try {
      var legacy = readLegacy();
      var state = legacy || demoState(school);
      state.school_name = school;
      state.data_mode = "demo";
      state.privacy_ack = false;
      var sealed = await sealWithPass(state, pass, null, ITER, null);
      localStorage.setItem(KEY, JSON.stringify(sealed.env));
      localStorage.removeItem(LEGACY_KEY);
      S = state;
      SESSION = { key: sealed.key, salt: sealed.salt, iter: sealed.iter };
      ENVELOPE = sealed.env;
      saveLock({ failures: 0, until: 0 });
      touch();
      showApp();
    } catch (e) {
      err.textContent = String(e.message || e);
    }
  }

  function showUnlock(msg) {
    var m = loadLock();
    var wait = m.until && m.until > Date.now() ? Math.ceil((m.until - Date.now()) / 1000) : 0;
    auth('' +
      '<div class="auth-card">' +
        '<div class="brand">Agent Mark</div>' +
        '<h2>Unlock this phone</h2>' +
        '<p class="small muted">Student data is encrypted. Enter the passcode you set on this device.</p>' +
        '<form id="unlock-form">' +
          '<label class="field"><span>Passcode</span><input id="un-pass" type="password" required autocomplete="current-password" autofocus></label>' +
          '<div id="auth-err" class="auth-err">' + (wait ? 'Too many attempts. Wait ' + wait + 's.' : (msg ? esc(msg) : '')) + '</div>' +
          '<button class="btn" type="submit"' + (wait ? " disabled" : "") + '>Unlock</button>' +
        '</form>' +
        '<p class="tiny muted" style="text-align:center"><a href="#" id="forgot">Forgot passcode? Wipe this phone</a></p>' +
      '</div>');
    $("#unlock-form").addEventListener("submit", doUnlock);
    $("#forgot").addEventListener("click", function (e) {
      e.preventDefault();
      wipePhone("A forgotten passcode cannot be recovered. Wipe this phone and start again?");
    });
    if (wait) setTimeout(function () { showUnlock(); }, Math.min(1000, wait * 1000));
  }

  async function doUnlock(ev) {
    ev.preventDefault();
    var pass = $("#un-pass").value;
    var err = $("#auth-err");
    var m = loadLock();
    if (m.until && m.until > Date.now()) {
      err.textContent = "Too many attempts. Wait " + Math.ceil((m.until - Date.now()) / 1000) + "s.";
      return;
    }
    err.textContent = "Unlocking…";
    try {
      var opened = await openEnvelope(ENVELOPE, pass);
      S = opened.state;
      SESSION = { key: opened.key, salt: opened.salt, iter: opened.iter };
      saveLock({ failures: 0, until: 0 });
      touch();
      showApp();
    } catch (e) {
      m.failures += 1;
      var wait = 0;
      if (m.failures >= 5) wait = Math.min(15 * 60 * 1000, 30000 * Math.pow(2, m.failures - 5));
      m.until = Date.now() + wait;
      saveLock(m);
      showUnlock(wait ? "Too many attempts." : "Wrong passcode. Try again.");
    }
  }

  function lock(reason) {
    S = null;
    SESSION = null;
    ENVELOPE = readEnvelope();
    if (!ENVELOPE) return showSetup();
    showUnlock(reason || "Locked.");
  }

  function showApp() {
    document.body.classList.remove("locked");
    var el = $("#auth");
    if (el) el.innerHTML = "";
    var lockBtn = $("#lock");
    if (lockBtn) lockBtn.hidden = false;
    touch();
    render();
  }

  // ---------- views ----------
  function modeBanner() {
    if (S.data_mode === "real") {
      return '<div class="notice"><strong>REAL DATA</strong> — this phone holds authorized student records. Lock it when not in use and export encrypted copies.</div>';
    }
    return '<div class="notice"><strong>DEMO MODE</strong> — synthetic data only. Complete the real-data gate in More before importing real students.</div>';
  }

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
    var cls = S.students[0] ? S.students[0].cls : "";
    return '' +
      '<div class="card hero-card">' +
        '<div class="term">' + esc(S.term) + (cls ? ' · ' + esc(cls) : '') + '</div>' +
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
      '<p class="tiny muted" style="text-align:center">Encrypted on this device · no cloud · no AI</p>';
  }

  function viewScores() {
    if (!S.students.length) {
      return '<h1>Enter scores</h1><div class="card"><div class="empty"><span class="big">∅</span>' +
        'No students yet. Import an encrypted roster from the More tab.</div></div>';
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
        'No students yet. Import an encrypted roster from the More tab.</div></div>';
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
            '<div><b>' + esc(S.school_name) + '</b><small>Terminal report · ' + esc(S.term) + '</small></div>' +
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
    var p = prefs();
    var gate = [
      { ok: true, label: "Passcode + encrypted store" },
      { ok: !!S.transfer_export_at, label: "Encrypted transfer export made" },
      { ok: !!S.privacy_ack, label: "Privacy notice acknowledged" },
      { ok: S.students.length === 0 && recordedCount() === 0, label: "Demo data cleared" }
    ];
    var gateOk = gate.every(function (g) { return g.ok; });
    return '<h1>More</h1>' +
      '<div class="card">' +
        '<h2>This device</h2>' +
        '<div class="row small"><span class="muted">School</span><span>' + esc(S.school_name) + '</span></div>' +
        '<div class="row small"><span class="muted">Mode</span><span class="pill ' + (S.data_mode === "real" ? "green" : "amber") + '">' + (S.data_mode === "real" ? "REAL DATA" : "DEMO") + '</span></div>' +
        '<div class="row small"><span class="muted">Students</span><span>' + S.students.length + '</span></div>' +
        '<div class="row small"><span class="muted">Marks</span><span>' + recordedCount() + '</span></div>' +
        '<div class="row small"><span class="muted">Encrypted store</span><span>' + (used / 1024).toFixed(1) + ' KB</span></div>' +
        '<div class="row small"><span class="muted">Last transfer export</span><span>' + esc(nowLabel(S.transfer_export_at)) + '</span></div>' +
        '<div class="row small"><span class="muted">Version</span><span>' + VERSION + '</span></div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Security</h2>' +
        '<p class="small muted">The passcode is never stored. PBKDF2-SHA-256 with ' + ITER.toLocaleString() + ' iterations derives an AES-256-GCM key. Locking drops the key from memory.</p>' +
        '<label class="field"><span>Auto-lock</span><select id="autolock">' +
          [1, 5, 15, 30].map(function (m) {
            return '<option value="' + m + '"' + (m === p.autoLockMin ? " selected" : "") + '>' + m + ' minute' + (m === 1 ? "" : "s") + '</option>';
          }).join("") +
        '</select></label>' +
        '<div class="stack">' +
          '<button class="btn secondary" id="change-pass">Change passcode</button>' +
          '<button class="btn secondary" id="lock-now">Lock now</button>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Encrypted transfer</h2>' +
        '<p class="small muted">Exports a single <code>.agmm</code> file encrypted with a separate transfer passphrase. Move it to the school PC by USB or share it; the desktop hub asks for the same passphrase. The file is not readable without it.</p>' +
        '<div class="stack">' +
          '<button class="btn" id="export-transfer">Export encrypted transfer file</button>' +
          '<button class="btn secondary" id="import-transfer">Import encrypted transfer file</button>' +
          '<input type="file" id="import-file" accept=".agmm,application/octet-stream" hidden>' +
        '</div>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Real-data gate</h2>' +
        '<ul class="checklist">' +
          gate.map(function (g) {
            return '<li><span class="mark ' + (g.ok ? "ok" : "no") + '">' + (g.ok ? "✓" : "!") + '</span><div><b>' + esc(g.label) + '</b></div></li>';
          }).join("") +
        '</ul>' +
        '<div class="stack" style="margin-top:.6rem">' +
          '<button class="btn secondary" id="clear-demo"' + (S.data_mode === "real" ? " disabled" : "") + '>Clear demo data</button>' +
          '<button class="btn secondary" id="ack-privacy">Acknowledge privacy notice</button>' +
          '<button class="btn"' + (gateOk && S.data_mode !== "real" ? "" : " disabled") + ' id="enable-real">Enable real data</button>' +
        '</div>' +
        '<p class="tiny muted">Real data needs a completed gate. The phone is not the system of record: signed report cards come from the desktop hub.</p>' +
      '</div>' +
      '<div class="card">' +
        '<h2>Privacy</h2>' +
        '<p class="small muted">This app makes no network requests. Student data is encrypted at rest and held only on this device. Clearing browser data or wiping the phone destroys it; keep an encrypted export.</p>' +
        '<button class="btn danger" id="wipe">Wipe this phone</button>' +
      '</div>' +
      '<p class="tiny muted" style="text-align:center">Agent Mark ' + VERSION + ' · local-first · no cloud · no AI</p>';
  }

  // ---------- render ----------
  var VIEWS = { home: viewHome, scores: viewScores, flags: viewFlags, card: viewCard, more: viewMore };

  function render() {
    if (!S) return lock();
    var root = $("#view");
    root.innerHTML = modeBanner() + VIEWS[ui.tab]();
    $$(".tabbar button").forEach(function (b) {
      var on = b.getAttribute("data-tab") === ui.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
    wire();
    window.scrollTo(0, 0);
  }

  function go(tab) { ui.tab = tab; touch(); render(); }

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

    var al = $("#autolock");
    if (al) al.addEventListener("change", function () {
      var p = prefs();
      p.autoLockMin = Number(al.value);
      savePrefs(p);
      touch();
      alert("Auto-lock set to " + p.autoLockMin + " minute" + (p.autoLockMin === 1 ? "" : "s") + ".");
    });

    var cp = $("#change-pass");
    if (cp) cp.addEventListener("click", changePasscode);
    var ln = $("#lock-now");
    if (ln) ln.addEventListener("click", function () { lock("Locked."); });

    var ex = $("#export-transfer");
    if (ex) ex.addEventListener("click", onExportTransfer);
    var im = $("#import-transfer");
    var file = $("#import-file");
    if (im && file) {
      im.addEventListener("click", function () { file.click(); });
      file.addEventListener("change", onImportTransfer);
    }

    var cd = $("#clear-demo");
    if (cd) cd.addEventListener("click", clearDemo);
    var ap = $("#ack-privacy");
    if (ap) ap.addEventListener("click", ackPrivacy);
    var er = $("#enable-real");
    if (er) er.addEventListener("click", enableReal);
    var wp = $("#wipe");
    if (wp) wp.addEventListener("click", function () {
      wipePhone("Wipe this phone? The encrypted store and all student data on this device will be destroyed.");
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

  async function onSaveScores() {
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
    await save();
    touch();
    render();
    message(writes.length ? "Saved " + (writes.length - cleared) + " mark" + (writes.length - cleared === 1 ? "" : "s") + (cleared ? " and cleared " + cleared : "") + "." : "Nothing to save.", writes.length ? "ok" : "warn");
  }

  async function changePasscode() {
    var oldPass = prompt("Current passcode:");
    if (!oldPass) return;
    var newPass = prompt("New passcode (" + MIN_PASS + "+ characters):");
    if (!newPass) return;
    if (newPass.length < MIN_PASS) { alert("Use at least " + MIN_PASS + " characters."); return; }
    var confirm = prompt("Repeat the new passcode:");
    if (confirm !== newPass) { alert("The passcodes do not match."); return; }
    try {
      await openEnvelope(ENVELOPE, oldPass);
      var sealed = await sealWithPass(S, newPass, null, ITER, ENVELOPE && ENVELOPE.created);
      localStorage.setItem(KEY, JSON.stringify(sealed.env));
      SESSION = { key: sealed.key, salt: sealed.salt, iter: sealed.iter };
      ENVELOPE = sealed.env;
      saveLock({ failures: 0, until: 0 });
      alert("Passcode changed. Older encrypted exports still use their own transfer passphrase.");
      render();
    } catch (e) {
      alert("The current passcode is wrong.");
    }
  }

  async function onExportTransfer() {
    var pass = prompt("Transfer passphrase (" + MIN_TRANSFER + "+ characters). The desktop hub will ask for this same passphrase:");
    if (!pass) return;
    if (pass.length < MIN_TRANSFER) { alert("Use at least " + MIN_TRANSFER + " characters."); return; }
    var confirm = prompt("Repeat the transfer passphrase:");
    if (confirm !== pass) { alert("The passphrases do not match."); return; }
    var payload = {
      version: 2,
      exported_at: new Date().toISOString(),
      school_name: S.school_name,
      term: S.term,
      data_mode: S.data_mode,
      students: S.students,
      scores: S.scores
    };
    try {
      var bytes = await sealTransfer(payload, pass);
      var filename = "agent-mark-" + String(S.term || "term").replace(/[^A-Za-z0-9._-]/g, "_") + ".agmm";
      await deliverFile(bytes, filename);
      S.transfer_export_at = new Date().toISOString();
      await save();
      render();
      alert("Encrypted transfer file created. Keep the transfer passphrase separate from the file.");
    } catch (e) {
      alert("Export failed: " + (e.message || e));
    }
  }

  async function deliverFile(bytes, filename) {
    var cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.Filesystem) {
      var res = await cap.Plugins.Filesystem.writeFile({
        path: filename,
        data: bytesToB64(bytes),
        directory: "CACHE"
      });
      if (cap.Plugins.Share) {
        await cap.Plugins.Share.share({ title: "Agent Mark encrypted export", url: res.uri });
      } else {
        alert("Encrypted file saved to the app cache: " + res.uri);
      }
      return;
    }
    var blob = new Blob([bytes], { type: "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  async function onImportTransfer(ev) {
    var f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!f) return;
    var pass = prompt("Transfer passphrase for this file:");
    if (!pass) return;
    try {
      var bytes = new Uint8Array(await f.arrayBuffer());
      var payload = await openTransfer(bytes, pass);
      if (payload.data_mode === "real" && !S.privacy_ack) {
        alert("This is a real-data export. Open More, acknowledge the privacy notice, then import again.");
        return;
      }
      if (!confirm("Replace the roster and scores on this phone with the imported data?")) return;
      S.students = payload.students.map(function (s) {
        return { code: String(s.code || ""), name: String(s.name || ""), cls: String(s.cls || "") };
      });
      S.scores = payload.scores || {};
      S.term = payload.term || S.term;
      S.school_name = payload.school_name || S.school_name;
      if (payload.data_mode === "real") S.data_mode = "real";
      await save();
      ui.student = null;
      touch();
      go("home");
      alert("Imported " + S.students.length + " students and " + recordedCount() + " marks.");
    } catch (e) {
      alert("Import failed. Check the passphrase and file. " + (e.message || e));
    }
  }

  async function clearDemo() {
    if (S.data_mode === "real") { alert("Refusing to clear data in real-data mode."); return; }
    if (!confirm("Clear all demo students and marks? This cannot be undone without an export.")) return;
    if (!confirm("Second confirmation: clear demo data now?")) return;
    S.students = [];
    S.scores = {};
    S.data_mode = "demo";
    S.privacy_ack = false;
    await save();
    render();
    alert("Demo data cleared. Make an encrypted export, acknowledge privacy, then enable real data.");
  }

  async function ackPrivacy() {
    S.privacy_ack = true;
    await save();
    render();
    alert("Privacy notice acknowledged. The school DPO/Head remains responsible for the legal basis and notices.");
  }

  async function enableReal() {
    if (S.data_mode === "real") return;
    if (!S.transfer_export_at) { alert("Make an encrypted transfer export first."); return; }
    if (!S.privacy_ack) { alert("Acknowledge the privacy notice first."); return; }
    if (S.students.length || recordedCount()) { alert("Clear demo data first."); return; }
    if (!confirm("Enable REAL DATA MODE on this phone? Only authorized student data may be entered after this.")) return;
    S.data_mode = "real";
    await save();
    render();
    alert("REAL DATA MODE enabled. Import the real roster from an encrypted desktop transfer.");
  }

  function wipePhone(message) {
    if (!confirm(message)) return;
    var typed = prompt('Type WIPE to destroy this phone\'s encrypted store:');
    if (typed !== "WIPE") return;
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(LEGACY_KEY);
      localStorage.removeItem(LOCK_KEY);
      localStorage.removeItem(PREF_KEY);
    } catch (e) { /* ignore */ }
    S = null;
    SESSION = null;
    ENVELOPE = null;
    showSetup();
  }

  // ---------- chrome ----------
  function chrome() {
    $$(".tabbar button").forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-tab")); });
    });

    var lb = $("#lock");
    if (lb) lb.addEventListener("click", function () { lock("Locked."); });

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

    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      window.addEventListener(ev, touch, { passive: true });
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) touch();
    });
    setInterval(function () {
      if (!S) return;
      var minutes = prefs().autoLockMin;
      if (Date.now() - lastActivity > minutes * 60 * 1000) lock("Locked after inactivity.");
    }, 10000);
  }

  ENVELOPE = readEnvelope();
  chrome();
  if (!ENVELOPE) showSetup();
  else showUnlock();
})();
