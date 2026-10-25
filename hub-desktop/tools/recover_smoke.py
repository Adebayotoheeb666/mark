"""Disaster-recovery smoke test for the desktop hub.

Simulates the case where `hub.db` and `vault.json` are gone (including their `.bak`
copies) but the backup folder survives. The app should adopt `vault-BK-*.json`, verify
the newest backup, restore it, and unlock an admin session.

Usage (PowerShell):
    $env:AGM_DATA_DIR = "$env:TEMP\\agm-recover"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9225"
    Start-Process .\\src-tauri\\target\\debug\\agent-mark-hub.exe
    python tools\\recover_smoke.py 9225 admin.e2e "Admin-Passphrase-2026!"
"""

import json
import sys
import time
import urllib.request

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9225
USER = sys.argv[2] if len(sys.argv) > 2 else "admin.e2e"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else "Admin-Passphrase-2026!"

JS = r"""
(async () => {
  const inv = window.__TAURI__.core.invoke;
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };
  step('vault_status_before', await inv('vault_status'));
  const r = await inv('recover_from_backup', {
    username: __USER__, password: __PASSWORD__, backupId: null,
  });
  step('recover', { username: r.username, role: r.role, must_change: r.must_change });
  const d = await inv('dashboard');
  step('dashboard', {
    students: d.students, scores: d.scores, reports: d.reports,
    data_mode: d.data_mode, drill_passed: d.drill_passed, username: d.username,
  });
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

    js = JS.replace("__USER__", json.dumps(USER)).replace("__PASSWORD__", json.dumps(PASSWORD))
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
