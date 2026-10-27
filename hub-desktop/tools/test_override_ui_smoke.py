r"""UI smoke test for the debug-only real-data test override.

Run against a clean DEBUG app started with `AGM_TEST_ALLOW_REAL_DATA=1`:

    $env:AGM_DATA_DIR = "$env:TEMP\agm-override-ui"
    $env:AGM_TEST_ALLOW_REAL_DATA = "1"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9234"
    Start-Process .\src-tauri\target\debug\agent-mark-hub.exe
    python tools\test_override_ui_smoke.py 9234

The test drives the setup form, opens the backup gate, stubs the prompt/confirm dialogs, and
clicks "Enable real data for testing". It then checks the TEST DATA badge, the red banner, and the
backend dashboard flag. Use a throwaway data directory only.
"""

import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9234

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
  const ADMIN = { username: 'admin.override.ui', password: 'Override-Ui-Pass-2026!' };
  document.querySelector('#su-school').value = 'Override UI Secondary School';
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
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'backup').click();
  await waitFor(() => text().includes('Test-only real-data unlock'), 'test override panel');
  step('panel_visible', text().includes('Test-only real-data unlock'));
  step('gate_before', {
    mode: document.querySelector('#mode-badge').textContent,
    live: DASH.live,
    test_override: DASH.test_override,
  });

  window.prompt = () => 'UI smoke test override reason 2026';
  window.confirm = () => true;
  [...document.querySelectorAll('#view button')].find((b) => b.textContent.includes('Enable real data for testing')).click();

  await waitFor(() => document.querySelector('#mode-badge') && document.querySelector('#mode-badge').textContent === 'TEST DATA', 'TEST DATA badge');
  await waitFor(() => text().includes('REAL DATA TEST MODE'), 'test mode banner');
  step('badge_after', document.querySelector('#mode-badge').textContent);
  step('banner_visible', text().includes('REAL DATA TEST MODE'));
  [...document.querySelectorAll('#nav button')].find((b) => b.dataset.s === 'dash').click();
  await waitFor(() => text().toLowerCase().includes('gate bypassed'), 'test stat on dashboard');
  step('stat_visible', text().toLowerCase().includes('gate bypassed'));
  const d = await window.__TAURI__.core.invoke('dashboard');
  step('dashboard', {
    data_mode: d.data_mode, live: d.live, test_override: d.test_override,
    test_override_available: d.test_override_available,
    backup_verified: d.backup_verified, drill_passed: d.drill_passed,
    privacy_ack: d.privacy_ack,
  });
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
