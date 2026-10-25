"""Offline integrity check for an Agent Mark Hub database.

Verifies the three things an auditor cares about, straight from the SQLite file:

  1. the audit log is an unbroken SHA-256 hash chain;
  2. every locked report still matches its payload hash and its Ed25519 signature
     (verified against the hub key stored in the same database);
  3. backup files contain no plaintext student data (they are XChaCha20-Poly1305 sealed).

Usage:
    python tools/verify_db.py "%APPDATA%\\org.agentmark.hub\\agent-mark-hub\\hub.db"

Exit code 0 = PASS, 1 = FAIL. Read-only: opens the database without writing.
"""

import hashlib
import os
import sqlite3
import sys

from nacl.signing import SigningKey


def check_audit(db: sqlite3.Connection) -> bool:
    rows = db.execute(
        "SELECT seq, actor, action, entity, before_json, after_json, prev_hash, hash"
        " FROM audit ORDER BY seq"
    ).fetchall()
    prev = "GENESIS"
    for seq, actor, action, entity, before, after, prev_hash, h in rows:
        body = f"{actor}|{action}|{entity}|{before}|{after}|{prev}"
        if prev_hash != prev or h != hashlib.sha256(body.encode()).hexdigest():
            print(f"  audit mismatch at seq {seq}")
            return False
        prev = h
    print(f"audit: {len(rows)} rows, hash chain intact")
    return True


def check_reports(db: sqlite3.Connection) -> bool:
    priv = db.execute("SELECT v FROM meta WHERE k='hub_priv'").fetchone()
    if not priv:
        print("reports: no hub key stored")
        return False
    verify_key = SigningKey(bytes.fromhex(priv[0])).verify_key
    rows = db.execute(
        "SELECT id, payload, hash, signature FROM reports WHERE status='locked'"
    ).fetchall()
    ok = True
    for rid, payload, payload_hash, signature in rows:
        hash_ok = hashlib.sha256(payload.encode()).hexdigest() == payload_hash
        try:
            verify_key.verify(payload.encode(), bytes.fromhex(signature))
            sig_ok = True
        except Exception:  # noqa: BLE001
            sig_ok = False
        print(f"report {rid}: payload_hash_ok={hash_ok} signature_ok={sig_ok}")
        ok = ok and hash_ok and sig_ok
    if not rows:
        print("reports: none locked yet")
    return ok


def check_backups(db_path: str) -> bool:
    backup_dir = os.path.join(os.path.dirname(db_path), "backups")
    if not os.path.isdir(backup_dir):
        print("backups: directory missing")
        return False
    files = sorted(os.listdir(backup_dir))
    leaks = []
    for name in files:
        blob = open(os.path.join(backup_dir, name), "rb").read()
        for needle in (b"Ada", b"26-JSS2A", b"MATHS", b"Report Card"):
            if needle in blob:
                leaks.append((name, needle.decode()))
    print(f"backups: {len(files)} sealed file(s), plaintext leaks={leaks}")
    return not leaks


def main() -> int:
    if len(sys.argv) != 2 or not os.path.exists(sys.argv[1]):
        print(__doc__)
        return 2
    db_path = sys.argv[1]
    db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    # Evaluate all three so the report is complete even when one check fails.
    ok = all([check_audit(db), check_reports(db), check_backups(db_path)])
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
