"""Headless smoke test for the real-data lifecycle commands.

Covers the paths that a pilot school needs after the gate is open:
quoted CSV parsing, student correction/export/deletion, score correction/deletion,
the hub fingerprint, and the corresponding audit entries.

Usage (PowerShell), from a clean data directory:
    $env:AGM_DATA_DIR = "$env:TEMP\\agm-lifecycle"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9236"
    Start-Process .\\src-tauri\\target\\debug\\agent-mark-hub.exe
    python tools\\lifecycle_smoke.py 9236

The script prints one JSON document and exits non-zero on the first failed assertion.
"""

import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9236

JS = r"""
(async () => {
  const inv = (c, a) => window.__TAURI__.core.invoke(c, a || {});
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };
  const assert = (ok, msg) => { if (!ok) throw new Error(msg); };
  const expectError = async (name, fn, re) => {
    let ok = false, msg = '';
    try { await fn(); } catch (e) { msg = String(e); ok = re.test(msg); }
    step(name, { blocked: ok, error: msg.slice(0, 180) });
    if (!ok) throw new Error(name + ' was not blocked: ' + msg);
  };

  const ADMIN = { username: 'admin.lifecycle', password: 'Lifecycle-Passphrase-2026!' };
  let st = await inv('vault_status');
  if (!st.initialized) {
    const setup = await inv('setup', {
      schoolName: 'Lifecycle Secondary School',
      username: ADMIN.username,
      password: ADMIN.password,
      confirm: ADMIN.password,
    });
    step('setup', { username: setup.username, role: setup.role });
  } else if (!st.unlocked) {
    await inv('unlock', { username: ADMIN.username, password: ADMIN.password });
  }

  step('seed', await inv('seed_demo'));
  let list = await inv('students');
  assert(list.length === 6, 'expected 6 demo students');
  const code = list[0].short_code;

  // RFC-4180 quoted field with a comma, plus a bad-header rejection.
  const quoted = 'short_code,first_name,last_name,class_label\n26-JSS2A-777,"Ada, Jr.",Okafor,JSS2-A\n';
  const dry = await inv('roster_import', { csvText: quoted, dryRun: true });
  step('quoted_csv_dry_run', { students: dry.would_import, errors: dry.errors });
  assert(dry.would_import === 1 && dry.errors.length === 0, 'quoted CSV did not validate');
  await expectError('bad_csv_header', () => inv('roster_import', {
    csvText: 'student_code,first,last,class\n26-JSS2A-778,Ada,Okafor,JSS2-A\n',
    dryRun: true,
  }), /header/i);

  step('student_update', await inv('student_update', {
    shortCode: code, first: 'Ada', last: 'Okafor-Updated', class: 'JSS2-A',
  }));
  list = await inv('students');
  assert(list.find((s) => s.short_code === code).last === 'Okafor-Updated', 'student update not visible');

  const exportText = await inv('student_export', { shortCode: code });
  const exported = JSON.parse(exportText);
  step('student_export', {
    format: exported.format,
    code: exported.student.short_code,
    scores: exported.scores.length,
    note_has_warning: /personal data/i.test(exported.note),
  });
  assert(exported.format === 'agent-mark-student-export', 'export format missing');
  assert(exported.student.last === 'Okafor-Updated', 'export has stale student data');

  const firstScore = await inv('score_add', {
    student: code, subject: 'MATHS', label: 'CA1', value: 15,
  });
  await expectError('short_correction_reason', () => inv('score_update', {
    student: code, subject: 'MATHS', label: 'CA1', value: 16, reason: 'short',
  }), /reason/i);
  const corrected = await inv('score_update', {
    student: code, subject: 'MATHS', label: 'CA1', value: 16, reason: 'data entry correction',
  });
  step('score_update', { original: firstScore, corrected });
  assert(corrected !== firstScore, 'score correction did not create a new version');

  const fp = await inv('hub_fingerprint');
  step('hub_fingerprint', { length: fp.length, value: fp });
  assert(/^[0-9A-F]{4}(-[0-9A-F]{4}){15}$/.test(fp), 'unexpected fingerprint format');

  step('score_delete', await inv('score_delete', {
    student: code, subject: 'MATHS', label: 'CA1', reason: 'wrong assessment entry',
  }));
  await expectError('delete_wrong_confirmation', () => inv('student_delete', {
    shortCode: code, confirmCode: 'not-the-code',
  }), /confirmation/i);
  step('student_delete', await inv('student_delete', { shortCode: code, confirmCode: code }));
  list = await inv('students');
  assert(!list.some((s) => s.short_code === code), 'student still present after deletion');

  await expectError('purge_wrong_confirmation', () => inv('purge_all_data', {
    confirm: 'purge',
  }), /PURGE/);
  step('purge_all_data', await inv('purge_all_data', { confirm: 'PURGE' }));
  const afterPurge = await inv('dashboard');
  step('purge_dashboard', {
    students: afterPurge.students, scores: afterPurge.scores,
    data_mode: afterPurge.data_mode, live: afterPurge.live,
  });
  assert(afterPurge.students === 0 && afterPurge.scores === 0, 'purge left live rows');
  assert(afterPurge.data_mode === 'demo' && afterPurge.live === false, 'purge did not reset demo mode');

  const audit = await inv('audit_list');
  const actions = new Set(audit.map((a) => a.action));
  const required = ['student.update', 'student.export', 'score.update', 'score.delete', 'student.delete', 'data.purge'];
  const missing = required.filter((a) => !actions.has(a));
  step('audit_lifecycle_actions', { required, missing });
  assert(missing.length === 0, 'missing audit actions: ' + missing.join(', '));

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
    ws = websocket.create_connection(target_url(PORT), timeout=180, suppress_origin=True)
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

    res = rpc(ws, 999, "Runtime.evaluate", {
        "expression": JS, "awaitPromise": True, "returnByValue": True,
    })
    result = res.get("result", {})
    if "exceptionDetails" in result:
        print("EXCEPTION:", json.dumps(result["exceptionDetails"], indent=2)[:6000])
        return 1
    print(result["result"].get("value"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
