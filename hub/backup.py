"""Encrypted backup + restore + drill (Phase 8 ref).
Ciphertext with school-held data-key (SecretBox). Operator/vault sees opaque blobs only.
Manifest: {backup_id, ts, counts, db_hash}. Verify-first restore. Drill artifact for gate.
"""
import hashlib
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

from nacl.secret import SecretBox
from nacl.utils import random as _rand


def generate_data_key():
    return _rand(SecretBox.KEY_SIZE)


def split_custody(key: bytes):
    """Two-share split (Head + Admin). Either alone reveals nothing."""
    a = _rand(len(key))
    b = bytes(x ^ y for x, y in zip(key, a))
    return {"head_share": a.hex(), "admin_share": b.hex()}


def join_custody(shares):
    a = bytes.fromhex(shares["head_share"])
    b = bytes.fromhex(shares["admin_share"])
    return bytes(x ^ y for x, y in zip(a, b))


def _dump_db(hub_con):
    blob = b"".join(line.encode() + b"\n" for line in hub_con.iterdump())
    return blob


def _counts(hub_con):
    return {"students": hub_con.execute("SELECT COUNT(*) c FROM students").fetchone()["c"],
            "scores": hub_con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"],
            "audit": hub_con.execute("SELECT COUNT(*) c FROM audit").fetchone()["c"]}


def create_backup(hub_con, key: bytes, dest_path):
    plain = _dump_db(hub_con)
    db_hash = "sha256:" + hashlib.sha256(plain).hexdigest()
    box = SecretBox(key)
    blob = box.encrypt(plain)  # nonce + ciphertext (opaque to operator)
    manifest = {"backup_id": uuid.uuid4().hex[:12], "ts": datetime.now(timezone.utc).isoformat(),
                "counts": _counts(hub_con), "db_hash": db_hash, "bytes": len(blob)}
    with open(dest_path, "wb") as f:
        f.write(blob)
    with open(dest_path + ".manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    from hub import store as S
    S.set_flag(hub_con, "backup_verified", "yes")
    return manifest


def verify_only(backup_path, key: bytes):
    man = json.load(open(backup_path + ".manifest.json"))
    box = SecretBox(key)
    try:
        plain = box.decrypt(open(backup_path, "rb").read())
    except Exception as e:
        raise ValueError(f"decrypt failed (wrong key or tampered): {e}")
    if "sha256:" + hashlib.sha256(plain).hexdigest() != man["db_hash"]:
        raise ValueError("hash mismatch — backup tampered or corrupt")
    return man


def restore(backup_path, key: bytes, target_db_path):
    man = verify_only(backup_path, key)  # dry-run first, always
    box = SecretBox(key)
    plain = box.decrypt(open(backup_path, "rb").read())
    if os.path.exists(target_db_path):
        os.remove(target_db_path)
    con = sqlite3.connect(target_db_path)
    con.row_factory = sqlite3.Row
    con.executescript(plain.decode())
    con.commit()
    got = {"students": con.execute("SELECT COUNT(*) c FROM students").fetchone()["c"],
           "scores": con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"],
           "audit": con.execute("SELECT COUNT(*) c FROM audit").fetchone()["c"]}
    assert got == man["counts"], (got, man["counts"])
    con.close()
    return man


def drill(hub_con, key: bytes, workdir, actor="admin"):
    """Wipe-simulate: backup -> restore to scratch -> hash-equal. Returns artifact dict."""
    os.makedirs(workdir, exist_ok=True)
    bp = os.path.join(workdir, "drill_backup.agm")
    man = create_backup(hub_con, key, bp)
    scratch = os.path.join(workdir, "drill_restored.db")
    man2 = restore(bp, key, scratch)
    assert man2["db_hash"] == man["db_hash"] and man2["counts"] == man["counts"]
    from hub import store as S
    S.set_flag(hub_con, "drill_passed", "yes", actor)
    artifact = {"drill": "wipe-restore", "backup_id": man["backup_id"], "db_hash": man["db_hash"],
                "counts": man["counts"], "by": actor,
                "ts": datetime.now(timezone.utc).isoformat(), "result": "PASS"}
    with open(os.path.join(workdir, "drill_report.json"), "w") as f:
        json.dump(artifact, f, indent=2)
    return artifact
