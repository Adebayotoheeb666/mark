"""Phase 6 tests: pairing, offline->sync, conflicts (server-wins), revoke, idempotency, local check."""
import os, sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from hub import store as S
from app import pairing as P
from app.client import TeacherApp
from engine.pack_loader import load_weights

WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))


def _hub():
    con = S.connect()
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})
    return con


def test_pairing_and_unpaired_blocked():
    con = _hub()
    app = TeacherApp()
    with pytest.raises(ValueError, match="not paired"):
        app.sync(con)
    code = P.issue_code(con)
    with pytest.raises(ValueError, match="head/admin"):
        app.pair(con, code, approver_role="teacher")
    app.pair(con, code, approver_role="head")
    assert P.is_paired(con, app.device_id)


def test_offline_entry_then_sync():
    con = _hub()
    app = TeacherApp()
    app.pair(con, P.issue_code(con))
    app.load_sheet(con, "MATHS")
    app.enter("S1", "MATHS", "CA1", 17)  # offline, queued
    assert con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"] == 0
    res = app.sync(con)  # reconnect
    assert len(res["applied"]) == 1 and not res["conflicts"]
    assert con.execute("SELECT value v FROM scores").fetchone()["v"] == 17


def test_local_range_blocked_before_queue():
    con = _hub()
    app = TeacherApp()
    app.pair(con, P.issue_code(con))
    app.load_sheet(con, "MATHS")
    with pytest.raises(ValueError, match="VAL-RANGE-01"):
        app.enter("S1", "MATHS", "CA1", 99)
    assert app.local.execute("SELECT COUNT(*) c FROM outbox").fetchone()["c"] == 0


def test_conflict_server_wins_and_resolve():
    con = _hub()
    a, b = TeacherApp(), TeacherApp()
    a.pair(con, P.issue_code(con))
    b.pair(con, P.issue_code(con))
    a.load_sheet(con, "MATHS")
    b.load_sheet(con, "MATHS")
    a.enter("S1", "MATHS", "CA1", 15)
    assert a.sync(con)["applied"]
    b.enter("S1", "MATHS", "CA1", 18)  # conflicting value
    res = b.sync(con)
    assert len(res["conflicts"]) == 1  # server kept 15
    op = res["conflicts"][0]["op_id"]
    out = b.resolve_conflict(con, op, keep_hub=False, new_value=16)  # teacher corrects
    assert out["kept"] == "mine"
    cur = con.execute("SELECT value, version FROM scores ORDER BY version DESC LIMIT 1").fetchone()
    assert cur["value"] == 16 and cur["version"] == 2


def test_revoke_blocks_and_repair_works():
    con = _hub()
    app = TeacherApp()
    app.pair(con, P.issue_code(con))
    app.load_sheet(con, "MATHS")
    P.revoke(con, app.device_id)
    app.enter("S1", "MATHS", "CA1", 12)
    with pytest.raises(ValueError, match="revoked"):
        app.sync(con)
    app2 = TeacherApp()  # replacement device
    app2.pair(con, P.issue_code(con))
    app2.load_sheet(con, "MATHS")
    app2.enter("S1", "MATHS", "CA1", 12)
    assert app2.sync(con)["applied"]


def test_idempotent_retry():
    con = _hub()
    app = TeacherApp()
    app.pair(con, P.issue_code(con))
    app.load_sheet(con, "MATHS")
    op = app.enter("S1", "MATHS", "CA1", 14)
    assert app.sync(con)["applied"] == [op]
    # retry same op (e.g., after timeout): hub dedups, no duplicate row
    app.local.execute("UPDATE outbox SET status='queued' WHERE op_id=?", (op,))
    assert app.sync(con)["applied"] == [op]
    assert con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"] == 1
