"""Headless end-to-end smoke test for the Agent Mark Hub desktop app.

Drives the *real* running Tauri app through WebView2's DevTools protocol: it connects to
the page, then calls the same `window.__TAURI__.core.invoke` bridge the UI uses. That
exercises the Rust commands, SQLite schema, hashing/signing and the backup/drill gate
without a single mouse click.

Usage (PowerShell):
    $env:AGM_DATA_DIR = "$env:TEMP\\agm-e2e"
    $env:AGM_AUTO_DEMO = "1"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9223"
    Start-Process .\\src-tauri\\target\\debug\\agent-mark-hub.exe
    python tools\\e2e_smoke.py 9223

Prints one JSON document with each step; exits non-zero if any step throws.
"""

import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9223

JS = r"""
(async () => {
  const inv = (c, a) => window.__TAURI__.core.invoke(c, a || {});
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };

  const st = await inv('students');
  step('students', st.length);
  const codes = st.map(s => s.short_code);

  const subjects = [["MATHS","CA1",20],["MATHS","CA2",20],["MATHS","Exam",60],["ENG","CA",40],["ENG","Exam",60]];
  // Five of six students get complete scores; the last is left blank on purpose so the
  // validation rules produce a missing-score flag and drafting must skip that student.
  for (let i = 0; i < codes.length - 1; i++) {
    for (const [sub, lab, max] of subjects) {
      const v = Math.round(max * (0.55 + 0.07 * ((i + lab.length) % 5)));
      await inv('score_add', { student: codes[i], subject: sub, label: lab, value: v, actor: 't.demo' });
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

  step('approve_teacher', await inv('report_approve', { id: draft.id, role: 'teacher', by: 't.demo' }));
  step('approve_head', await inv('report_approve', { id: draft.id, role: 'head', by: 'h.demo' }));
  step('lock', await inv('report_lock', { id: draft.id, by: 'h.demo' }));
  const html = await inv('report_html', { id: draft.id });
  step('html_has_card', html.includes('Report Card'));
  step('html_has_draft_banner', html.includes('DRAFT - NOT OFFICIAL'));
  step('html_has_signature_block', html.includes('Approvals'));

  const tpl = (await inv('comment_pick', { subject: 'MATHS', band: 'A' }))[0];
  step('template', tpl ? tpl.id : null);
  const pv = await inv('comment_preview', { templateId: tpl.id, ctx: {
    name: 'Ada', subject: 'MATHS', score: '62/100', strength: 'steady classwork',
    next_step: 'practise word problems' } });
  step('comment_preview', pv);
  step('comment_save', await inv('comment_save', { student: codes[0], subject: 'MATHS', term: '2026-T1',
    templateId: tpl.id, text: pv.text, author: 't.demo' }));

  step('backup_created', (await inv('backup_create')).length > 0);
  step('drill', await inv('drill_run'));
  step('go_live', await inv('go_live'));
  const d = await inv('dashboard');
  step('dashboard', { students: d.students, scores: d.scores, flags_open: d.flags_open,
    reports_locked: d.reports_locked, backup_verified: d.backup_verified,
    drill_passed: d.drill_passed, live: d.live });
  step('audit_rows', (await inv('audit_list')).length);

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
    ws = websocket.create_connection(target_url(PORT), timeout=120, suppress_origin=True)

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

    res = rpc(ws, 999, "Runtime.evaluate", {
        "expression": JS, "awaitPromise": True, "returnByValue": True,
    })
    result = res.get("result", {})
    if "exceptionDetails" in result:
        print("EXCEPTION:", json.dumps(result["exceptionDetails"], indent=2)[:4000])
        return 1
    print(result["result"].get("value"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

