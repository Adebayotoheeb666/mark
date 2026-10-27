"""Headless UI smoke test for the Agent Mark Hub desktop app.

Drives the real WebView2 page through the DevTools protocol: fills the setup form,
saves the recovery code, signs in, checks the role-aware shell, exercises the
backup gate, and verifies the lock/auto-lock path. Backend coverage lives in
e2e_smoke.py and the Rust tests.

Usage (PowerShell):
    $env:AGM_DATA_DIR = "$env:TEMP\\agm-ui-smoke"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9224"
    Start-Process .\\src-tauri\\target\\debug\\agent-mark-hub.exe
    python tools\\ui_smoke.py 9224
"""

import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9224

JS = r"""
(async () => {
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, label, timeout = 15000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { const v = fn(); if (v) return v; } catch (e) { /* keep waiting */ }
      await sleep(100);
    }
    throw new Error('timed out waiting for ' + label);
  };
  const text = () => document.body.innerText;

  await waitFor(() => document.querySelector('#su-school'), 'setup form');
  step('setup_screen', text().includes('Set up this school PC'));

  const ADMIN = { username: 'admin.ui', password: 'Admin-Ui-Passphrase-2026!' };
  document.querySelector('#su-school').value = 'UI Smoke Secondary School';
  document.querySelector('#su-user').value = ADMIN.username;
  document.querySelector('#su-pass').value = ADMIN.password;
  document.querySelector('#su-confirm').value = ADMIN.password;
  document.querySelector('#su-school').closest('form').requestSubmit();

  const code = await waitFor(() => {
    const el = document.querySelector('.recovery');
    return el && el.textContent.trim().length > 20 ? el.textContent.trim() : null;
  }, 'recovery code');
  step('recovery_code_len', code.length);

  document.querySelector('#saved-code').checked = true;
  [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Continue to the hub')).click();
  await waitFor(() => document.querySelector('#mode-badge') && document.querySelector('#mode-badge').textContent === 'DEMO', 'dashboard');
  step('dashboard_after_setup', {
    mode: document.querySelector('#mode-badge').textContent,
    user: document.querySelector('#user-chip').textContent,
    users_nav_visible: document.querySelector('#nav-users').style.display !== 'none',
    has_backup_link: text().includes('Backup'),
  });

  // Backup gate is visible to the admin and starts with an empty database.
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'backup').click();
  await waitFor(() => text().includes('Backup & restore gate'), 'backup gate');
  const clearBtn = () => [...document.querySelectorAll('#view button')].find((b) => b.textContent.includes('Clear demo data'));
  step('clear_demo_disabled_when_empty', !!clearBtn() && clearBtn().disabled);

  // Seed demo data through the same bridge, then confirm the gate offers the clear action.
  await window.__TAURI__.core.invoke('seed_demo');
  DASH = null;
  await render();
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'backup').click();
  await waitFor(() => clearBtn(), 'clear demo button');
  step('clear_demo_enabled_with_demo', !clearBtn().disabled);

  // Students page exposes the admin data-lifecycle actions.
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'students').click();
  await waitFor(() => text().includes('Data lifecycle'), 'students lifecycle card');
  const studentButtons = [...document.querySelectorAll('#view button')].map((b) => b.textContent.trim());
  step('student_lifecycle_actions', {
    edit: studentButtons.includes('Edit'),
    export: studentButtons.includes('Export'),
    delete: studentButtons.includes('Delete'),
  });
  if (!studentButtons.includes('Edit') || !studentButtons.includes('Export') || !studentButtons.includes('Delete')) {
    throw new Error('student lifecycle actions missing');
  }

  // Account page exposes the hub signing-key fingerprint.
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'account').click();
  const fp = await waitFor(() => {
    const el = document.querySelector('#hub-fp');
    return el && el.textContent.trim().length > 60 ? el.textContent.trim() : null;
  }, 'hub fingerprint');
  step('account_fingerprint', { length: fp.length, groups: fp.split('-').length });
  if (fp.split('-').length !== 16) throw new Error('unexpected fingerprint format');

  // Lock and sign back in through the form.
  document.querySelector('#lock-btn').click();
  await waitFor(() => document.querySelector('#li-user'), 'login form after lock');
  step('locked_screen', text().includes('Unlock this hub'));
  document.querySelector('#li-user').value = ADMIN.username;
  document.querySelector('#li-pass').value = ADMIN.password;
  document.querySelector('#li-user').closest('form').requestSubmit();
  await waitFor(() => document.querySelector('#mode-badge') && document.querySelector('#mode-badge').textContent === 'DEMO', 'dashboard after login');
  step('login_after_lock', document.querySelector('#user-chip').textContent);

  // Shorten the front-end idle timer and verify it locks the session.
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lockApp(), 250);
  await waitFor(() => document.querySelector('#li-user'), 'auto-lock login screen', 5000);
  step('auto_lock', text().includes('Unlock this hub'));

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
