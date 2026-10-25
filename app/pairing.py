"""Pairing registry (Phase 6 ref). Hub-side device table + short-code approval.
Production: QR (hub_pubkey_fp + code + LAN URL) + TLS pinning; here: protocol logic.
"""
import sqlite3
import secrets
from datetime import datetime, timezone, timedelta

DEVICES_DDL = """
CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, status TEXT, approved_by TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS pair_codes(code TEXT PRIMARY KEY, expires_at TEXT);
CREATE TABLE IF NOT EXISTS applied_ops(op_id TEXT PRIMARY KEY);
"""


def ensure(con):
    con.executescript(DEVICES_DDL)
    con.commit()


def issue_code(con, ttl_min=15):
    ensure(con)
    code = f"{secrets.randbelow(1_000_000):06d}"
    exp = (datetime.now(timezone.utc) + timedelta(minutes=ttl_min)).isoformat()
    con.execute("INSERT INTO pair_codes(code,expires_at) VALUES(?,?)", (code, exp))
    con.commit()
    return code


def approve(con, code, device_id, approver_role, approver="head"):
    ensure(con)
    if approver_role not in ("head", "admin"):
        raise ValueError("pairing requires head/admin approval")
    row = con.execute("SELECT expires_at FROM pair_codes WHERE code=?", (code,)).fetchone()
    if not row:
        raise ValueError("invalid pairing code")
    if row["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise ValueError("pairing code expired")
    con.execute("INSERT OR REPLACE INTO devices(id,status,approved_by,created_at) VALUES(?,?,?,?)",
                (device_id, "paired", approver,
                 datetime.now(timezone.utc).isoformat()))
    con.execute("DELETE FROM pair_codes WHERE code=?", (code,))
    con.commit()
    return True


def is_paired(con, device_id):
    ensure(con)
    r = con.execute("SELECT status FROM devices WHERE id=?", (device_id,)).fetchone()
    return bool(r) and r["status"] == "paired"


def revoke(con, device_id):
    ensure(con)
    con.execute("UPDATE devices SET status='revoked' WHERE id=?", (device_id,))
    con.commit()


def op_applied(con, op_id):
    ensure(con)
    return bool(con.execute("SELECT 1 FROM applied_ops WHERE op_id=?", (op_id,)).fetchone())


def mark_applied(con, op_id):
    ensure(con)
    con.execute("INSERT OR IGNORE INTO applied_ops(op_id) VALUES(?)", (op_id,))
    con.commit()
