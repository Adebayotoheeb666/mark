"""Phase 5 hub tests: wizard/import, versioning, RBAC, audit chain, gate, crash-reopen."""
import csv
import json
import os, sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from hub import store as S
from hub import auth as A
from engine.pack_loader import load_weights

WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))
ROSTER = os.path.join(ROOT, "hub", "testdata_roster.csv")


def _roster_csv():
    os.makedirs(os.path.join(ROOT, "hub"), exist_ok=True)
    with open(ROSTER, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["short_code", "first_name", "last_name", "class_label"])
        w.writerow(["26-JSS2A-001", "Ada", "Demo", "JSS2-A"])
        w.writerow(["26-JSS2A-002", "Bola", "Demo", "JSS2-A"])
        w.writerow(["26-JSS2A-002", "Dupe", "Row", "JSS2-A"])  # seeded dup
    return ROSTER


def test_import_dry_run_catches_dup():
    con = S.connect()
    rep = S.import_roster(con, _roster_csv(), dry_run=True)
    assert len(rep["errors"]) == 1 and "duplicate" in rep["errors"][0]["error"]
    assert con.execute("SELECT COUNT(*) c FROM students").fetchone()["c"] == 0


def test_full_cycle_offline_and_gate():
    con = S.connect()
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})
    # clean roster
    with open(ROSTER, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["short_code", "first_name", "last_name", "class_label"])
        w.writerow(["26-JSS2A-001", "Ada", "Demo", "JSS2-A"])
    assert S.import_roster(con, ROSTER, dry_run=False)["errors"] == []
    S.add_score(con, "26-JSS2A-001", "MATHS", "CA1", 17, "t1")
    # go-live blocked before backup+drill
    with pytest.raises(ValueError, match="Go-Live blocked"):
        S.go_live(con)
    assert any("backup" in b.lower() for b in S.readiness(con)["blocking"])
    S.set_flag(con, "backup_verified", "yes")
    S.set_flag(con, "drill_passed", "yes")
    assert S.readiness(con)["ready"] is True
    assert S.go_live(con) is True


def test_score_versioning_and_dup():
    con = S.connect()
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})
    sid = S.add_score(con, "S1", "MATHS", "CA1", 15, "t1")
    with pytest.raises(ValueError, match="VAL-DUP-01"):
        S.add_score(con, "S1", "MATHS", "CA1", 18, "t1")  # conflicting dupe
    nid = S.update_score(con, sid, 16, "t1")
    cur = con.execute("SELECT version, supersedes FROM scores WHERE id=?", (nid,)).fetchone()
    assert cur["version"] == 2 and cur["supersedes"] == sid
    with pytest.raises(ValueError, match="VAL-RANGE-01"):
        S.update_score(con, sid, 99, "t1")


def test_rbac_and_audit_chain():
    assert A.can("teacher", "scores.enter") is True
    assert A.can("teacher", "reports.lock") is False
    assert A.can("viewer", "scores.enter") is False
    assert A.can("head", "reports.lock") is True
    con = S.connect()
    S.set_flag(con, "backup_verified", "yes", actor="admin")
    S.set_flag(con, "drill_passed", "yes", actor="admin")
    assert S.audit_verify(con) is True
    n = con.execute("SELECT COUNT(*) c FROM audit").fetchone()["c"]
    assert n == 2


def test_crash_reopen(tmp_path):
    db = str(tmp_path / "hub.db")
    con = S.connect(db)
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})
    S.add_score(con, "S1", "MATHS", "CA1", 12, "t1")
    con.close()  # simulate power cut / restart
    con2 = S.connect(db)
    assert con2.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"] == 1
    assert S.audit_verify(con2) is True
