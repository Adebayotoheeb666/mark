"""Headless end-to-end smoke test for the Agent Mark Hub desktop app.

Drives the *real* running Tauri app through WebView2's DevTools protocol: it connects to
the page, then calls the same `window.__TAURI__.core.invoke` bridge the UI uses. That
exercises the Rust commands, encrypted store, accounts/roles, audit chain and the
backup/restore gate without a single mouse click.

Usage (PowerShell):
    $env:AGM_DATA_DIR = "$env:TEMP\\agm-e2e"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
    Start-Process .\\src-tauri\\target\\debug\\agent-mark-hub.exe
    python tools\\e2e_smoke.py 9223

Prints one JSON document with each step; exits non-zero if any step throws.
"""

import base64
import json
import pathlib
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9223

FIXTURE = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "tests" / "fixtures" / "mobile-export.agmm"
MOBILE_B64 = base64.b64encode(FIXTURE.read_bytes()).decode("ascii")
_bad = bytearray(FIXTURE.read_bytes())
_bad[-1] ^= 0x01
MOBILE_B64_BAD = base64.b64encode(bytes(_bad)).decode("ascii")

JS = r"""
(async () => {
  const inv = (c, a) => window.__TAURI__.core.invoke(c, a || {});
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };
  const expectError = async (name, fn, re) => {
    let ok = false, msg = '';
    try { await fn(); } catch (e) { msg = String(e); ok = re.test(msg); }
    step(name, { blocked: ok, error: msg.slice(0, 180) });
    if (!ok) throw new Error(name + ' was not blocked: ' + msg);
  };

  const ADMIN = { username: 'admin.e2e', password: 'Admin-Passphrase-2026!' };
  const TEACHER = { username: 'teacher.e2e', temp: 'Teacher-Temp-2026!', password: 'Teacher-Passphrase-2026!' };
  const HEAD = { username: 'head.e2e', temp: 'Head-Temp-2026!', password: 'Head-Passphrase-2026!' };
  const VIEWER = { username: 'viewer.e2e', temp: 'Viewer-Temp-2026!', password: 'Viewer-Passphrase-2026!' };
  const MOBILE_B64 = "__MOBILE_B64__";
  const MOBILE_B64_BAD = "__MOBILE_B64_BAD__";

  let st = await inv('vault_status');
  step('vault_initialized', st.initialized);
  if (!st.initialized) {
    const setup = await inv('setup', {
      schoolName: 'E2E Secondary School',
      username: ADMIN.username,
      password: ADMIN.password,
      confirm: ADMIN.password,
    });
    step('setup', { username: setup.username, role: setup.role, recovery_len: setup.recovery_code.length });
  } else if (!st.unlocked) {
    await inv('unlock', { username: ADMIN.username, password: ADMIN.password });
  }

  // Demo mode must refuse a real roster import before the gate is complete.
  await expectError('demo_import_blocked', () => inv('roster_import', {
    csvText: 'short_code,first_name,last_name,class_label\n26-JSS2A-099,Real,Student,JSS2-A',
    dryRun: false,
  }), /locked|real-data/i);

  step('seed', await inv('seed_demo'));

  step('add_teacher', await inv('user_add', {
    username: TEACHER.username, role: 'teacher', tempPassword: TEACHER.temp,
  }));
  step('add_head', await inv('user_add', {
    username: HEAD.username, role: 'head', tempPassword: HEAD.temp,
  }));
  step('add_viewer', await inv('user_add', {
    username: VIEWER.username, role: 'viewer', tempPassword: VIEWER.temp,
  }));

  // Teacher: change temp password, enter scores, scan flags, draft, approve.
  await inv('lock');
  let u = await inv('unlock', { username: TEACHER.username, password: TEACHER.temp });
  step('teacher_must_change', u.must_change);
  step('teacher_change_password', await inv('change_password', {
    oldPassword: TEACHER.temp, newPassword: TEACHER.password, confirm: TEACHER.password,
  }));

  const stus = await inv('students');
  step('students', stus.length);
  const codes = stus.map(s => s.short_code);
  const subjects = [["MATHS","CA1",20],["MATHS","CA2",20],["MATHS","Exam",60],["ENG","CA",40],["ENG","Exam",60]];
  for (let i = 0; i < codes.length - 1; i++) {
    for (const [sub, lab, max] of subjects) {
      const v = Math.round(max * (0.55 + 0.07 * ((i + lab.length) % 5)));
      await inv('score_add', { student: codes[i], subject: sub, label: lab, value: v });
    }
  }
  const fl = await inv('flags_scan');
  step('flags_total', fl.length);
  step('flag_rules', [...new Set(fl.map(f => f.rule_id))].sort());
  step('flags_open', (await inv('flags')).filter(f => f.status === 'open').length);
  step('drafts', await inv('reports_draft_all', { term: '2026-T1' }));
  const reps = await inv('reports');
  step('reports_total', reps.length);
  const draft = reps.find(r => r.status === 'draft');
  step('first_report', draft ? { student: draft.student_code, status: draft.status, hash_len: draft.hash.length } : null);
  step('approve_teacher', await inv('report_approve', { id: draft.id }));
  await expectError('teacher_cannot_backup', () => inv('backup_create'), /admin/i);

  // Head: change temp password, approve, lock/sign, render.
  await inv('lock');
  u = await inv('unlock', { username: HEAD.username, password: HEAD.temp });
  step('head_must_change', u.must_change);
  await inv('change_password', { oldPassword: HEAD.temp, newPassword: HEAD.password, confirm: HEAD.password });
  step('approve_head', await inv('report_approve', { id: draft.id }));
  step('lock', await inv('report_lock', { id: draft.id }));
  const html = await inv('report_html', { id: draft.id });
  step('html_has_card', html.includes('Report Card'));
  step('html_has_draft_banner', html.includes('DRAFT - NOT OFFICIAL') === false);
  step('html_has_signature_block', html.includes('Digitally signed'));

  // Viewer is read-only.
  await inv('lock');
  await inv('unlock', { username: VIEWER.username, password: VIEWER.temp });
  await inv('change_password', { oldPassword: VIEWER.temp, newPassword: VIEWER.password, confirm: VIEWER.password });
  await expectError('viewer_cannot_score', () => inv('score_add', {
    student: codes[0], subject: 'MATHS', label: 'CA1', value: 10,
  }), /role|read-only|teacher/i);

  // Admin: clear demo, then full backup, verify, drill, privacy, enable real mode.
  await inv('lock');
  await inv('unlock', { username: ADMIN.username, password: ADMIN.password });
  step('clear_demo', await inv('clear_demo'));
  await expectError('real_mode_needs_gate', () => inv('enable_real_mode'), /blocked|backup|drill|privacy/i);
  step('backup_created', (await inv('backup_create')).length > 0);
  step('backup_verify', await inv('backup_verify'));
  step('drill', await inv('drill_run'));
  step('privacy_ack', await inv('privacy_ack'));
  step('enable_real', await inv('enable_real_mode'));

  // Mobile transfer import: dry-run, wrong passphrase, tampered bytes, real import, idempotence.
  const mobDry = await inv('mobile_import', {
    fileB64: MOBILE_B64, passphrase: 'Transfer-Passphrase-2026!', dryRun: true,
  });
  step('mobile_dry_run', { students: mobDry.would_import, scores: mobDry.would_import_scores, errors: mobDry.errors });
  await expectError('mobile_wrong_passphrase', () => inv('mobile_import', {
    fileB64: MOBILE_B64, passphrase: 'wrong-transfer-passphrase', dryRun: true,
  }), /passphrase|damaged/i);
  await expectError('mobile_tampered_file', () => inv('mobile_import', {
    fileB64: MOBILE_B64_BAD, passphrase: 'Transfer-Passphrase-2026!', dryRun: true,
  }), /passphrase|damaged/i);
  const mob = await inv('mobile_import', {
    fileB64: MOBILE_B64, passphrase: 'Transfer-Passphrase-2026!', dryRun: false,
  });
  step('mobile_import', { students: mob.would_import, scores: mob.would_import_scores, errors: mob.errors });
  const mobAgain = await inv('mobile_import', {
    fileB64: MOBILE_B64, passphrase: 'Transfer-Passphrase-2026!', dryRun: false,
  });
  step('mobile_reimport_idempotent', { students: mobAgain.would_import, scores: mobAgain.would_import_scores, errors: mobAgain.errors });

  const d = await inv('dashboard');
  step('dashboard', {
    students: d.students, scores: d.scores, flags_open: d.flags_open,
    reports_locked: d.reports_locked, backup_verified: d.backup_verified,
    drill_passed: d.drill_passed, live: d.live, data_mode: d.data_mode,
    privacy_ack: d.privacy_ack, username: d.username, role: d.role,
  });
  step('audit_rows', (await inv('audit_list')).length);
  step('backup_list', (await inv('backup_list')).length);

  // Disaster recovery: restore the newest on-disk backup without relying on the live DB.
  step('backup_before_recover', await inv('backup_create'));
  await inv('lock');
  const rec = await inv('recover_from_backup', {
    username: ADMIN.username, password: ADMIN.password, backupId: null,
  });
  step('recover_from_backup', { username: rec.username, role: rec.role });
  const dr = await inv('dashboard');
  step('recover_dashboard', {
    students: dr.students, scores: dr.scores, drill_passed: dr.drill_passed,
    data_mode: dr.data_mode,
  });

  // Wrong password must not unlock.
  await inv('lock');
  await expectError('wrong_password', () => inv('unlock', {
    username: ADMIN.username, password: 'not-the-password',
  }), /invalid|password/i);
  await inv('unlock', { username: ADMIN.username, password: ADMIN.password });

  return JSON.stringify(out, null, 2);
})()
"""


def target_url(port: int) -> str:
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as r:
                targets = json.load(r)
            pages = [t for t in targets if t.get("type") == "page"]
            if pages:
                return pages[0]["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit(f"no WebView2 DevTools target on port {port}")


def rpc(ws, msg_id: int, method: str, params: dict) -> dict:
    ws.send(json.dumps({"id": msg_id, "method": method, "params": params}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == msg_id:
            return msg


def main() -> int:
    # WebView2 rejects cross-origin websocket handshakes (403) unless the browser is started
    # with --remote-allow-origins; simply omitting the Origin header is enough here.
    ws = websocket.create_connection(target_url(PORT), timeout=180, suppress_origin=True)

    # Wait until the page is loaded and the Tauri bridge is injected.
    for i in range(1, 60):
        res = rpc(ws, i, "Runtime.evaluate", {
            "expression": "document.readyState === 'complete' && !!window.__TAURI__",
            "returnByValue": True,
        })
        if res.get("result", {}).get("result", {}).get("value") is True:
            break
        time.sleep(0.5)
    else:
        print("page never became ready", file=sys.stderr)
        return 1

    js = JS.replace("__MOBILE_B64_BAD__", MOBILE_B64_BAD).replace("__MOBILE_B64__", MOBILE_B64)
    res = rpc(ws, 999, "Runtime.evaluate", {
        "expression": js, "awaitPromise": True, "returnByValue": True,
    })
    result = res.get("result", {})
    if "exceptionDetails" in result:
        print("EXCEPTION:", json.dumps(result["exceptionDetails"], indent=2)[:6000])
        return 1
    print(result["result"].get("value"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
