"""Capture real screenshots of the running Hub through WebView2's DevTools protocol.

Usage (the app must already be running with --remote-debugging-port):
    python tools/screenshot.py 9226 ..\\website\\assets

It captures, in order:
    screenshot-dashboard.png   fresh demo state (6 students, no scores)
    screenshot-reports.png     after seeding scores and drafting five reports
    screenshot-report-card.png the print-sheet overlay for the first report

The seeding calls the same Tauri commands the UI uses, so the screenshots show real
output rather than a mock.
"""

import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

import websocket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9226
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else ".")


def page_target(port: int) -> str:
    for _ in range(60):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2) as r:
                pages = [t for t in json.load(r) if t.get("type") == "page"]
            if pages:
                return pages[0]["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.5)
    raise SystemExit("no DevTools page target")


class CDP:
    def __init__(self, url: str):
        self.ws = websocket.create_connection(url, timeout=60, suppress_origin=True)
        self.n = 0

    def call(self, method: str, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == self.n:
                return msg

    def eval(self, expression: str, await_promise: bool = False):
        res = self.call(
            "Runtime.evaluate",
            expression=expression,
            awaitPromise=await_promise,
            returnByValue=True,
        )
        result = res.get("result", {})
        if "exceptionDetails" in result:
            raise RuntimeError(json.dumps(result["exceptionDetails"])[:1200])
        return result.get("result", {}).get("value")

    def shot(self, name: str, height: int | None = None, width: int = 1280):
        params = {"format": "png"}
        if height:
            params["clip"] = {"x": 0, "y": 0, "width": width, "height": height, "scale": 1}
        res = self.call("Page.captureScreenshot", **params)
        data = base64.b64decode(res["result"]["data"])
        path = OUT / name
        path.write_bytes(data)
        print(f"{name}  {len(data) / 1024:.0f} KB")

    def wait_ready(self):
        for _ in range(60):
            if self.eval("document.readyState === 'complete' && !!window.__TAURI__"):
                return
            time.sleep(0.5)
        raise SystemExit("page never became ready")


SEED = r"""
(async () => {
  const inv = (c, a) => window.__TAURI__.core.invoke(c, a || {});
  const st = await inv('students');
  const codes = st.map(s => s.short_code);
  const plan = [["MATHS","CA1",20],["MATHS","CA2",20],["MATHS","Exam",60],["ENG","CA",40],["ENG","Exam",60]];
  for (let i = 0; i < codes.length - 1; i++) {
    for (const [sub, lab, max] of plan) {
      const v = Math.round(max * (0.55 + 0.07 * ((i + lab.length) % 5)));
      await inv('score_add', { student: codes[i], subject: sub, label: lab, value: v, actor: 't.demo' });
    }
  }
  await inv('reports_draft_all', { term: '2026-T1' });
  return codes.length;
})()
"""


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    cdp = CDP(page_target(PORT))
    cdp.wait_ready()
    cdp.call("Page.enable")
    time.sleep(0.6)

    cdp.shot("screenshot-dashboard.png", height=min(cdp.eval("window.innerHeight"), 660), width=cdp.eval("window.innerWidth"))

    n = cdp.eval(SEED, await_promise=True)
    print("seeded students:", n)
    cdp.eval("document.querySelector('#nav button[data-s=\"reports\"]').click()")
    time.sleep(0.8)
    cdp.shot("screenshot-reports.png")

    clicked = cdp.eval(
        "(() => { const b = [...document.querySelectorAll('#view button')]"
        ".find(x => x.textContent.trim() === 'View'); if (b) { b.click(); return true; } return false; })()"
    )
    print("opened report preview:", clicked)
    time.sleep(1.2)
    cdp.shot("screenshot-report-card.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
