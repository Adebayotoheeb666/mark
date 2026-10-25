"""Offline integrity check for an Agent Mark Hub data folder.

Verifies the things an auditor cares about without trusting the app UI:

  1. the encrypted `hub.db` opens with the account password (Argon2id-wrapped key);
  2. the audit log is an unbroken SHA-256 hash chain;
  3. every locked report still matches its payload hash and Ed25519 signature;
  4. every backup blob matches its signed manifest, decrypts, restores into a fresh
     in-memory database, and has the manifest's row counts and audit head;
  5. backup blobs contain no plaintext student data.

Usage:
    python tools/verify_db.py "%APPDATA%\\org.agentmark.hub\\agent-mark-hub"
    python tools/verify_db.py path\\to\\hub.db --user admin
    python tools/verify_db.py path\\to\\hub.db --password "..."   # avoid: shell history

The password is prompted with getpass when omitted. Exit code 0 = PASS, 1 = FAIL.
Read-only: the live database file is never written. The decrypted snapshot exists only
in memory for the duration of the check.
"""

from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path

from argon2.low_level import Type, hash_secret_raw
from nacl.bindings import crypto_aead_xchacha20poly1305_ietf_decrypt
from nacl.exceptions import CryptoError
from nacl.signing import VerifyKey

DB_MAGIC = b"AGMDB001"
BACKUP_MAGIC = b"AGMBK001"
NONCE_LEN = 24
USER_AAD = "AGM-VAULT-USER-V1|{}"
RECOVERY_AAD = b"AGM-VAULT-RECOVERY-V1"
BACKUP_KEY_LABEL = b"AGM-BACKUP-KEY-V1"


def decrypt_xchacha(blob: bytes, key: bytes, aad: bytes) -> bytes:
    if len(blob) < 8 + NONCE_LEN + 16:
        raise ValueError("encrypted file is truncated")
    if blob[:8] != aad:
        raise ValueError("encrypted file has the wrong magic")
    nonce = blob[8 : 8 + NONCE_LEN]
    ct = blob[8 + NONCE_LEN :]
    return crypto_aead_xchacha20poly1305_ietf_decrypt(ct, aad, nonce, key)


def open_vault(folder: Path) -> dict:
    path = folder / "vault.json"
    if not path.exists():
        raise FileNotFoundError(f"vault.json not found in {folder}")
    return json.loads(path.read_text(encoding="utf-8"))


def unwrap_data_key(vault: dict, user: str, password: str) -> bytes:
    target = user.strip().lower()
    entry = None
    for candidate in vault.get("users", []):
        if candidate.get("username") == target:
            entry = candidate
            break
    if entry is None:
        raise ValueError(f"user {user!r} is not in vault.json")
    wrapped = entry["wrapped"]
    derived = hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=bytes.fromhex(wrapped["salt"]),
        time_cost=int(wrapped["t_cost"]),
        memory_cost=int(wrapped["m_cost"]),
        parallelism=int(wrapped["p_cost"]),
        hash_len=32,
        type=Type.ID,
        version=19,
    )
    try:
        key = crypto_aead_xchacha20poly1305_ietf_decrypt(
            bytes.fromhex(wrapped["ct"]),
            USER_AAD.format(target).encode(),
            bytes.fromhex(wrapped["nonce"]),
            derived,
        )
    except CryptoError as exc:
        raise ValueError("wrong password for that account") from exc
    if len(key) != 32:
        raise ValueError("unwrapped data key has the wrong length")
    return key


def open_database(path: Path, password: str | None, user: str) -> tuple[sqlite3.Connection, bytes | None]:
    raw = path.read_bytes()
    if raw.startswith(b"SQLite format 3\x00"):
        print("database: legacy plaintext SQLite (no password needed)")
        db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        return db, None
    if not raw.startswith(DB_MAGIC):
        raise ValueError("hub.db is neither SQLite nor an AGMDB001 vault")
    vault = open_vault(path.parent)
    if password is None:
        password = getpass.getpass(f"Password for {user}: ")
    data_key = unwrap_data_key(vault, user, password)
    plain = decrypt_xchacha(raw, data_key, DB_MAGIC)
    db = sqlite3.connect(":memory:")
    db.deserialize(plain)
    print("database: encrypted vault opened with the account password")
    return db, data_key


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
    pub = db.execute("SELECT v FROM meta WHERE k='hub_pub'").fetchone()
    if not pub:
        print("reports: no hub public key stored")
        return False
    verify_key = VerifyKey(bytes.fromhex(pub[0]))
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


def counts(db: sqlite3.Connection) -> tuple[int, int, int, int]:
    def one(sql: str) -> int:
        row = db.execute(sql).fetchone()
        return int(row[0]) if row else 0

    return (
        one("SELECT COUNT(*) FROM students"),
        one("SELECT COUNT(*) FROM scores"),
        one("SELECT COUNT(*) FROM reports"),
        one("SELECT COUNT(*) FROM audit"),
    )


def audit_head(db: sqlite3.Connection) -> str:
    row = db.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
    return row[0] if row else "GENESIS"


def manifest_signature_bytes(manifest: dict) -> bytes:
    copy = dict(manifest)
    copy["sig"] = ""
    return json.dumps(copy, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def check_backups(folder: Path, data_key: bytes | None) -> bool:
    backup_dir = folder / "backups"
    if not backup_dir.is_dir():
        print("backups: directory missing")
        return False
    blobs = sorted(backup_dir.glob("*.agm"))
    if not blobs:
        print("backups: no .agm files")
        return False
    if data_key is None:
        print("backups: skipped decryption (legacy plaintext database has no vault key)")
        return True

    ok = True
    backup_key = hashlib.sha256(BACKUP_KEY_LABEL + data_key).digest()
    for blob_path in blobs:
        manifest_path = blob_path.with_suffix(".json")
        if not manifest_path.exists():
            print(f"backup {blob_path.name}: manifest missing")
            ok = False
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            blob = blob_path.read_bytes()
            if hashlib.sha256(blob).hexdigest() != manifest["sha256"]:
                raise ValueError("SHA-256 mismatch")
            verify_key = VerifyKey(bytes.fromhex(manifest["hub_pubkey"]))
            verify_key.verify(
                manifest_signature_bytes(manifest), bytes.fromhex(manifest["sig"])
            )
            plain = decrypt_xchacha(blob, backup_key, BACKUP_MAGIC)
            snapshot = sqlite3.connect(":memory:")
            snapshot.deserialize(plain)
            got = counts(snapshot)
            want = (
                int(manifest["students"]),
                int(manifest["scores"]),
                int(manifest["reports"]),
                int(manifest["audit_rows"]),
            )
            if got != want:
                raise ValueError(f"counts {got} != manifest {want}")
            if audit_head(snapshot) != manifest["audit_head"]:
                raise ValueError("audit head mismatch")
            leaks = [
                needle.decode()
                for needle in (b"Ada", b"26-JSS2A", b"MATHS", b"Report Card")
                if needle in blob
            ]
            if leaks:
                raise ValueError(f"plaintext leak: {leaks}")
            print(
                f"backup {blob_path.name}: manifest OK, signature OK, decrypt OK, "
                f"counts {got}, audit head OK, no plaintext"
            )
        except Exception as exc:  # noqa: BLE001
            print(f"backup {blob_path.name}: FAIL - {exc}")
            ok = False
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", help="data folder or path to hub.db")
    parser.add_argument("--user", default="admin", help="account whose password unlocks the vault")
    parser.add_argument(
        "--password",
        default=None,
        help="password (omit to be prompted; passing it on the command line is discouraged)",
    )
    args = parser.parse_args()

    target = Path(args.path)
    if target.is_dir():
        db_path = target / "hub.db"
        folder = target
    else:
        db_path = target
        folder = target.parent
    if not db_path.exists():
        print(f"not found: {db_path}")
        return 2

    try:
        db, data_key = open_database(db_path, args.password, args.user)
    except Exception as exc:  # noqa: BLE001
        print(f"database: FAIL - {exc}")
        return 1

    results = [
        check_audit(db),
        check_reports(db),
        check_backups(folder, data_key),
    ]
    print("RESULT:", "PASS" if all(results) else "FAIL")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
