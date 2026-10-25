"""Phase 4 tests: integrity (REP-INT-01/02/03), approvals, tamper, versioning, batch."""
import copy
import os, sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from engine import reports as R

RESULTS = {
    "26-JSS2A-001": {"MATHS": {"total": 75, "avg_tenths": 750, "avg": 75.0, "grade": "A"},
                     "ENG": {"total": 68, "avg_tenths": 680, "avg": 68.0, "grade": "B"}},
}
COMMENTS = {"MATHS": "Excellent work.", "ENG": "Strong effort."}
RULE_V = "engine 0.3.0 + ng-secondary 1.4.0"


def _locked():
    snap, h = R.snapshot_results(RESULTS)
    d = R.draft_report("26-JSS2A-001", "1T-26", "JSS2-A", RESULTS["26-JSS2A-001"], COMMENTS, h, RULE_V)
    R.teacher_review(d, "Mrs. Ade")
    return R.head_approve_and_lock(d, "Mr. Head", h), h


def test_draft_watermark_no_sig():
    _, h = R.snapshot_results(RESULTS)
    d = R.draft_report("26-JSS2A-001", "1T-26", "JSS2-A", RESULTS["26-JSS2A-001"], COMMENTS, h, RULE_V)
    assert d["status"] == "draft" and d["signature"] is None
    html = R.render_html(d)
    assert "DRAFT" in html and "NOT OFFICIAL" in html
    assert R.verify(d) is False


def test_lock_requires_teacher_review():
    _, h = R.snapshot_results(RESULTS)
    d = R.draft_report("26-JSS2A-001", "1T-26", "JSS2-A", RESULTS["26-JSS2A-001"], COMMENTS, h, RULE_V)
    with pytest.raises(ValueError, match="teacher review missing"):
        R.head_approve_and_lock(d, "Mr. Head", h)


def test_mutated_source_aborts():
    locked, h = _locked()
    assert R.verify(locked) is True
    tampered = copy.deepcopy(RESULTS)
    tampered["26-JSS2A-001"]["MATHS"]["grade"] = "F"  # attacker edits after snapshot
    _, h2 = R.snapshot_results(tampered)
    assert h2 != h  # snapshot mismatch => regenerate required
    d2 = R.draft_report("26-JSS2A-001", "1T-26", "JSS2-A", RESULTS["26-JSS2A-001"], COMMENTS, h, RULE_V)
    R.teacher_review(d2, "Mrs. Ade")
    with pytest.raises(ValueError, match="REP-INT-01"):
        R.head_approve_and_lock(d2, "Mr. Head", h2)


def test_tampered_locked_fails_verify():
    locked, _ = _locked()
    locked["payload"]["results"]["MATHS"]["grade"] = "F"
    assert R.verify(locked) is False


def test_correction_new_version_reapproval():
    locked, h = _locked()
    assert locked["payload"]["version"] == 1
    fixed = copy.deepcopy(RESULTS["26-JSS2A-001"])
    fixed["MATHS"] = {"total": 76, "avg_tenths": 760, "avg": 76.0, "grade": "A"}
    _, h2 = R.snapshot_results({**RESULTS, "26-JSS2A-001": fixed})
    d2 = R.correct_report(locked, fixed, COMMENTS, h2)
    assert d2["payload"]["version"] == 2 and d2["status"] == "draft" and d2["approvals"] == []
    R.teacher_review(d2, "Mrs. Ade")
    locked2 = R.head_approve_and_lock(d2, "Mr. Head", h2)
    assert R.verify(locked2) is True


def test_batch_naming_qr_footer():
    assert R.batch_filename("26", "1T", "JSS2-A", "26-JSS2A-014") == "26_1T_JSS2-A_26-JSS2A-014.pdf"
    locked, _ = _locked()
    assert locked["qr"].startswith("AGM1:") and locked["hash"] in locked["qr"]
    html = R.render_html(locked)
    assert "DRAFT" not in html and locked["report_id"] in html and "Approved" in html
