"""Phase 2 tests: seeded suite + adversarial + lifecycle + thresholds."""
import os, sys
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from engine import validate as V
from engine.flags import FlagStore


def test_seeded_error_suite():
    # mirrors demo/seeded_errors.csv expectations
    f = V.check_range(25, 20)
    assert f and f["rule_id"] == "VAL-RANGE-01" and f["severity"] == "blocking"
    f = V.check_missing(None, "CA1")
    assert f and f["rule_id"] == "VAL-MISS-01"
    f = V.check_jump(84, 52)  # +32 >= 25
    assert f and f["rule_id"] == "VAL-JUMP-01" and f["severity"] == "warning"
    assert V.check_jump(60, 52) is None  # +8, no flag
    f = V.check_duplicate([17, 18])
    assert f and f["rule_id"] == "VAL-DUP-01"
    assert V.check_duplicate([17, 17]) is None
    f = V.check_weights_sum([20, 20, 59])
    assert f and f["rule_id"] == "VAL-WEIGHT-01"
    assert V.check_weights_sum([20, 20, 60]) is None
    f = V.check_comment_len("x" * 250, 210)
    assert f and f["rule_id"] == "VAL-COMLEN-01"


def test_outlier_and_colswap():
    peers = [58, 61, 59, 62, 60, 57, 63, 61, 59, 60]
    assert V.check_outlier(61, peers) is None
    f = V.check_outlier(98, peers)
    assert f and f["rule_id"] == "VAL-OUTLIER-01" and "never auto-changed" in f["message"]
    assert V.check_outlier(98, [60, 61]) is None  # too few peers
    ca = [20, 25, 18, 22, 30, 15, 28, 24]   # low CA pcts
    ex = [80, 85, 78, 90, 82, 88, 79, 84]   # high Exam pcts
    f = V.check_colswap(ca, ex)
    assert f and f["rule_id"] == "VAL-COLSWAP-01"
    assert V.check_colswap([70] * 8, [72] * 8) is None
    assert V.check_colswap([20], [90]) is None  # too few rows


def test_adversarial_boundaries():
    assert V.check_range(20, 20) is None
    assert V.check_range(0, 20) is None
    assert V.check_range(20.0001, 20)["rule_id"] == "VAL-RANGE-01"
    assert V.check_range(-0.5, 20)["rule_id"] == "VAL-RANGE-01"
    assert V.check_range(" 85 ", 100)["rule_id"] == "VAL-TYPE-01"
    assert V.check_missing("   ")["rule_id"] == "VAL-MISS-01"
    assert V.run_entry_checks(None, 20)["rule_id"] == "VAL-MISS-01"


def test_threshold_override_versioned():
    strict = V.Thresholds(jump_pts=10, outlier_sd=2.0, version="strict-v2")
    assert V.check_jump(65, 52, strict)["rule_id"] == "VAL-JUMP-01"  # +13 >= 10
    assert strict.version == "strict-v2"


def test_flag_lifecycle_and_no_automutate():
    store = FlagStore()
    r = store.raise_flag(V.check_range(25, 20), student_code="26-JSS2A-001", subject="MATHS")
    assert r["status"] == "open" and r["flag_id"].startswith("F")
    assert len(store.list(severity="blocking")) == 1
    with pytest.raises(ValueError, match="requires a reason"):
        store.dispose(r["flag_id"], "confirmed", actor="t1", note="")
    rec = store.dispose(r["flag_id"], "confirmed", actor="t1", note="Verified with paper script.")
    assert rec["status"] == "resolved" and rec["disposition"] == "confirmed"
    with pytest.raises(ValueError, match="already resolved"):
        store.dispose(r["flag_id"], "corrected", actor="t1")
    # module exposes no score-mutating API: grep guard
    import pathlib
    src = pathlib.Path(ROOT, "engine", "validate.py").read_text() + pathlib.Path(ROOT, "engine", "flags.py").read_text()
    for banned in ("UPDATE scores", "SET value", "db.execute", "sqlite"):
        assert banned not in src
    assert len(store.audit) == 2  # raise + dispose logged


def test_messages_plain_language():
    msgs = [V.check_range(99, 20)["message"], V.check_jump(84, 52)["message"],
            V.check_outlier(98, [58, 61, 59, 62, 60, 57, 63, 61, 59, 60])["message"]]
    for m in msgs:
        assert len(m) < 200 and any(w in m.lower() for w in ("check", "confirm", "review", "second look"))
