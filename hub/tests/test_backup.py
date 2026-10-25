"""Phase 8 tests: backup/restore/drill (HARD GATE), tamper, wrong key, updater rollback, PII-grep."""
import json
import os, sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from hub import store as S
from hub import backup as B
from hub import updater as U
from engine.pack_loader import load_weights

WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))


def _hub_with_data():
    con = S.connect()
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})
    con.execute("INSERT INTO students(id,short_code,first,last,class) VALUES('u1','26-JSS2A-001','Ada','Demo','JSS2-A')")
    S.add_score(con, "26-JSS2A-001", "MATHS", "CA1", 17, "t1")
    return con


def test_backup_verify_restore_hash_equal(tmp_path):
    con = _hub_with_data()
    key = B.generate_data_key()
    bp = str(tmp_path / "b.agm")
    man = B.create_backup(con, key, bp)
    assert man["counts"]["scores"] == 1 and man["db_hash"].startswith("sha256:")
    man2 = B.verify_only(bp, key)
    assert man2["db_hash"] == man["db_hash"]
    target = str(tmp_path / "restored.db")
    man3 = B.restore(bp, key, target)
    assert man3["counts"] == man["counts"]
    import sqlite3
    con2 = sqlite3.connect(target)
    con2.row_factory = sqlite3.Row
    assert con2.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"] == 1
    assert S.audit_verify(S.connect(target)) or True  # file-backed reopen check below
    con3 = S.connect(target)
    assert S.audit_verify(con3) is True


def test_tamper_and_wrong_key_fail(tmp_path):
    con = _hub_with_data()
    key = B.generate_data_key()
    bp = str(tmp_path / "b.agm")
    B.create_backup(con, key, bp)
    raw = bytearray(open(bp, "rb").read())
    raw[50] ^= 0xFF
    open(bp, "wb").write(bytes(raw))
    with pytest.raises(ValueError, match="decrypt failed|hash mismatch"):
        B.verify_only(bp, key)
    with pytest.raises(ValueError, match="decrypt failed"):
        B.verify_only(bp, B.generate_data_key())


def test_drill_artifact_unlocks_gate(tmp_path):
    con = _hub_with_data()
    assert S.readiness(con)["ready"] is False  # blocked pre-drill
    key = B.generate_data_key()
    art = B.drill(con, key, str(tmp_path))
    assert art["result"] == "PASS" and os.path.exists(os.path.join(str(tmp_path), "drill_report.json"))
    assert S.get_flag(con, "drill_passed") == "yes" and S.get_flag(con, "backup_verified") == "yes"
    assert S.go_live(con) is True


def test_custody_split_neither_share_alone():
    key = B.generate_data_key()
    shares = B.split_custody(key)
    assert B.join_custody(shares) == key
    assert shares["head_share"] != key.hex() and shares["admin_share"] != key.hex()


def test_updater_bad_sig_refused_and_rollback():
    rel = U.make_release("0.4.0", b"hub-binary-0.4.0")
    prev = U.apply_update(rel, rel["pubkey"])
    assert U.CURRENT["version"] == "0.4.0"
    U.rollback(prev)
    assert U.CURRENT["version"] == "0.3.0"
    bad = dict(rel)
    bad["blob"] = b"tampered-binary"
    with pytest.raises(ValueError, match="bad signature"):
        U.apply_update(bad, rel["pubkey"])
    assert U.CURRENT["version"] == "0.3.0"  # intact


def test_pii_grep_relay_and_logs_clean():
    import pathlib
    for p in [pathlib.Path(ROOT, "relay", "store.py"), pathlib.Path(ROOT, "relay", "crypto.py")]:
        src = p.read_text().lower()
        for banned in ("student_name", "grade_table", "print(", "password"):
            assert banned not in src, (p, banned)
