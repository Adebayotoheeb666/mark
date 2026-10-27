"""Write website/version.json and website/downloads/SHA256SUMS.txt from the built artifacts.

Run after `release.ps1` (or by hand once all three files exist in website/downloads):

    python scripts/stamp_release.py --version 0.1.0

The download page reads version.json at runtime, and its no-JS fallbacks in
download.html are rewritten here as well, so no HTML edits are needed for a new
build. Sizes are recorded in bytes; hashes are uppercase SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = ROOT / "website" / "downloads"


def digest(path: Path) -> tuple[int, str]:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return path.stat().st_size, h.hexdigest()


def git_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return ""


def sync_version_text(manifest: dict) -> None:
    """Rewrite version strings and artifact filenames in the static download page."""
    page = ROOT / "website" / "download.html"
    text = page.read_text(encoding="utf-8")
    v = manifest["version"]
    text = re.sub(r"Agent-Mark-Hub-\d+\.\d+\.\d+-", f"Agent-Mark-Hub-{v}-", text)
    text = re.sub(r"Version \d+\.\d+\.\d+", f"Version {v}", text)
    page.write_text(text, encoding="utf-8", newline="")


def sync_download_page(manifest: dict) -> None:
    """Keep the no-JS fallbacks in download.html in step with version.json.

    The page hydrates from version.json at runtime, but a visitor with JavaScript
    disabled (or a mirror that strips scripts) must not see yesterday's checksum.
    """
    page = ROOT / "website" / "download.html"
    text = page.read_text(encoding="utf-8")
    windows = manifest["windows"]

    def mb(n: int) -> str:
        return f"{n / 1048576:.2f} MB"

    def short(h: str) -> str:
        return f"{h[:8]}\u2026{h[-6:]}"

    def replace(prefix: str, art: dict) -> None:
        nonlocal text
        text = re.sub(
            rf'(id="h-{prefix}"[^>]*>).*?(</span>)',
            lambda m: m.group(1) + art["sha256"] + m.group(2),
            text,
            flags=re.S,
        )
        text = re.sub(
            rf'(id="copy-{prefix}"[^>]*data-copy=")[^"]*(")',
            lambda m: m.group(1) + art["sha256"] + m.group(2),
            text,
        )
        for elem, tag, value in (
            (f"size-{prefix}", "span", mb(art["bytes"])),
            (f"tbl-size-{prefix}", "td", mb(art["bytes"])),
            (f"tbl-hash-{prefix}", "td", short(art["sha256"])),
        ):
            text = re.sub(
                rf'(id="{elem}"[^>]*>).*?(</{tag}>)',
                lambda m: m.group(1) + value + m.group(2),
                text,
                flags=re.S,
            )

    replace("setup", windows["installer"])
    replace("msi", windows["msi"])
    replace("portable", windows["portable"])
    page.write_text(text, encoding="utf-8", newline="")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="0.1.0")
    ap.add_argument("--channel", default="pilot")
    ap.add_argument("--notes", default="")
    ap.add_argument("--signed", dest="signed", action="store_true", help="Windows artifacts are code-signed")
    ap.add_argument("--unsigned", dest="signed", action="store_false", help="Internal unsigned pilot build")
    ap.add_argument("--signing-status", default="unsigned")
    ap.set_defaults(signed=False)
    args = ap.parse_args()

    v = args.version
    setup = DOWNLOADS / f"Agent-Mark-Hub-{v}-x64-setup.exe"
    msi = DOWNLOADS / f"Agent-Mark-Hub-{v}-x64.msi"
    portable = DOWNLOADS / f"Agent-Mark-Hub-{v}-windows-x64-portable.zip"
    for p in (setup, msi, portable):
        if not p.exists():
            raise SystemExit(f"missing artifact: {p}")

    setup_bytes, setup_hash = digest(setup)
    msi_bytes, msi_hash = digest(msi)
    portable_bytes, portable_hash = digest(portable)

    manifest = {
        "version": v,
        "channel": args.channel,
        "released": date.today().isoformat(),
        "notes": args.notes
        or f"Agent Mark Hub {v}: NSIS per-user installer, MSI for managed deployment, portable ZIP, and the mobile companion (PWA).",
        "windows": {
            "installer": {
                "file": f"downloads/{setup.name}",
                "bytes": setup_bytes,
                "sha256": setup_hash.upper(),
                "kind": "nsis",
                "install_mode": "currentUser",
                "requires_admin": False,
            },
            "msi": {
                "file": f"downloads/{msi.name}",
                "bytes": msi_bytes,
                "sha256": msi_hash.upper(),
                "kind": "msi",
                "install_mode": "perMachine",
                "requires_admin": True,
            },
            "portable": {
                "file": f"downloads/{portable.name}",
                "bytes": portable_bytes,
                "sha256": portable_hash.upper(),
                "kind": "zip",
            },
            "minimum_os": "Windows 10 (64-bit)",
            "architectures": ["x86_64"],
        },
        "mobile": {
            "type": "pwa",
            "url": "/app/",
            "offline": True,
            "platforms": ["android", "ios"],
            "note": "Encrypted companion: passcode + AES-256-GCM local store, auto-lock, and an encrypted .agmm transfer to the desktop hub. No cloud relay or always-on sync.",
        },
        "data_policy": {
            "telemetry": False,
            "analytics": False,
            "ai": False,
            "network_calls_for_student_data": False,
        },
        "build": {
            "git_commit": git_commit(),
            "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "signing": {
                "signed": bool(args.signed),
                "status": args.signing_status,
            },
        },
        "pilot_gate": {
            "real_student_data_allowed": False,
            "reason": (
                "External security review has not closed the open findings; "
                + (
                    "the Windows artifacts are code-signed, but the published APK is still debug-signed."
                    if args.signed
                    else "the Windows artifacts are unsigned (internal pilot only)."
                )
            ),
        },
    }

    (ROOT / "website" / "version.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    (DOWNLOADS / "SHA256SUMS.txt").write_text(
        f"{setup_hash}  {setup.name}\n{msi_hash}  {msi.name}\n{portable_hash}  {portable.name}\n",
        encoding="utf-8",
    )
    sync_download_page(manifest)
    sync_version_text(manifest)

    print(f"version.json        {v}  ({args.channel})")
    print(f"{setup.name}  {setup_bytes} bytes  {setup_hash}")
    print(f"{msi.name}  {msi_bytes} bytes  {msi_hash}")
    print(f"{portable.name}  {portable_bytes} bytes  {portable_hash}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
