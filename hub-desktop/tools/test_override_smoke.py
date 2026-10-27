r"""Smoke test for the debug-only real-data override and the release gate.

Normal mode (debug build with the override available):
    $env:AGM_DATA_DIR = "$env:TEMP\agm-override-smoke"
    $env:AGM_TEST_ALLOW_REAL_DATA = "1"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9230"
    Start-Process .\src-tauri\target\debug\agent-mark-hub.exe
    python tools\test_override_smoke.py 9230

Release-gate regression (any build; no override expected):
    $env:AGM_DATA_DIR = "$env:TEMP\agm-release-gate"
    $env:AGM_TEST_ALLOW_REAL_DATA = "1"   # deliberately set; release must ignore it
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9235"
    Start-Process .\src-tauri\target\release\agent-mark-hub.exe
    python tools\test_override_smoke.py 9235 --expect-blocked

The normal run proves the normal gate still blocks, a short reason is rejected, and a valid
override enters real-data mode with test_override=true and an audit row. It then creates a backup
so the offline verifier has a signed manifest and hub key to check. The --expect-blocked run proves
the same environment variable cannot bypass the gate on a build without the debug/feature opt-in.
Use a throwaway data directory only.
"""

import argparse
import json
import sys
import time
import urllib.request

import websocket

USER = "admin.override"
PASSWORD = "Override-Pass-2026!"

JS = r"""
(async () => {
  const inv = window.__TAURI__.core.invoke;
  const out = { steps: [] };
  const step = (name, value) => { out.steps.push([name, value]); return value; };
  const EXPECT_BLOCKED = __EXPECT_BLOCKED__;

  const st = await inv('vault_status');
  step('vault_status', st);
  if (!st.initialized) {
    const s = await inv('setup', {
      schoolName: 'Override Test School',
      username: __USER__, password: __PASSWORD__, confirm: __PASSWORD__,
    });
    step('setup', { username: s.username, role: s.role, recovery_len: s.recovery_code.length });
  } else if (!st.unlocked) {
    await inv('unlock', { username: __USER__, password: __PASSWORD__ });
  }

  let normalError = null;
  try { await inv('enable_real_mode'); } catch (e) { normalError = String(e); }
  step('normal_gate_blocked', normalError);

  if (EXPECT_BLOCKED) {
    const before = await inv('dashboard');
    step('override_available', before.test_override_available);
    let blocked = null;
    try {
      await inv('enable_real_mode', { testOverrideReason: 'Release gate regression 2026' });
    } catch (e) { blocked = String(e); }
    step('override_blocked', blocked);
    const after = await inv('dashboard');
    step('dashboard_after', {
      data_mode: after.data_mode, live: after.live, test_override: after.test_override,
    });
    return JSON.stringify(out, null, 2);
  }

  let shortError = null;
  try { await inv('enable_real_mode', { testOverrideReason: 'too short' }); }
  catch (e) { shortError = String(e); }
  step('short_reason_blocked', shortError);

  step('override_enable', await inv('enable_real_mode', {
    testOverrideReason: 'Automated test override for CI',
  }));

  const d = await inv('dashboard');
  step('dashboard', {
    data_mode: d.data_mode, live: d.live, test_override: d.test_override,
    test_override_available: d.test_override_available,
    backup_verified: d.backup_verified, drill_passed: d.drill_passed,
    privacy_ack: d.privacy_ack, students: d.students, scores: d.scores,
    warning: d.warning,
  });

  const a = await inv('audit_list');
  const overrideAudit = a.find((row) => row.action === 'real_mode.test_override');
  step('audit_override', overrideAudit || null);

  step('backup_create', (await inv('backup_create')).length > 0);
  step('backup_verify', await inv('backup_verify'));

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


def steps(result: dict) -> dict:
    return {name: value for name, value in result["steps"]}


def check_override(result: dict) -> None:
    s = steps(result)
    assert s["normal_gate_blocked"], "normal gate did not block"
    assert "at least 12" in s["short_reason_blocked"], s["short_reason_blocked"]
    assert "TEST MODE" in s["override_enable"], s["override_enable"]
    d = s["dashboard"]
    assert d["data_mode"] == "real" and d["live"] and d["test_override"], d
    assert not d["backup_verified"] and not d["drill_passed"] and not d["privacy_ack"], d
    assert s["audit_override"] and s["audit_override"]["action"] == "real_mode.test_override"
    assert s["backup_verify"]["ok"] is True, s["backup_verify"]


def check_blocked(result: dict) -> None:
    s = steps(result)
    assert s["override_available"] is False, s["override_available"]
    assert s["override_blocked"], "release build accepted the test override"
    assert "blocked" in s["override_blocked"].lower(), s["override_blocked"]
    d = s["dashboard_after"]
    assert d["data_mode"] == "demo" and not d["live"] and not d["test_override"], d


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("port", nargs="?", type=int, default=9230)
    parser.add_argument(
        "--expect-blocked",
        action="store_true",
        help="assert that the test override is unavailable (release-gate regression)",
    )
    args = parser.parse_args()

    ws = websocket.create_connection(target_url(args.port), timeout=180, suppress_origin=True)
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

    js = (
        JS.replace("__USER__", json.dumps(USER))
        .replace("__PASSWORD__", json.dumps(PASSWORD))
        .replace("__EXPECT_BLOCKED__", "true" if args.expect_blocked else "false")
    )
    res = rpc(ws, 999, "Runtime.evaluate", {
        "expression": js, "awaitPromise": True, "returnByValue": True,
    })
    result = res.get("result", {})
    if "exceptionDetails" in result:
        print("EXCEPTION:", json.dumps(result["exceptionDetails"], indent=2)[:6000])
        return 1

    raw = result["result"].get("value")
    print(raw)
    data = json.loads(raw)
    try:
        if args.expect_blocked:
            check_blocked(data)
        else:
            check_override(data)
    except AssertionError as exc:
        print(f"ASSERTION FAILED: {exc}", file=sys.stderr)
        return 1
    print("RESULT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
