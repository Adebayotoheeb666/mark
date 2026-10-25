"""Phase 3 tests: picker, interpolation fuzz, overflow, fit, usage counters."""
import os, sys
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from engine.comments import CommentBank

CSV = os.path.join(ROOT, "packs", "comments.example.csv")
CTX = {"name": "Ada", "subject": "Mathematics", "score": "75",
       "strength": "problem solving", "next_step": "Daily practice of fractions"}


def _bank():
    b = CommentBank()
    n = b.load_csv(CSV)
    assert n == 24, n
    return b


def test_coverage_per_band():
    b = _bank()
    cov = b.coverage()
    for subj in ("MATHS", "ENG"):
        for band in ("A", "B", "C", "D", "F"):
            assert cov.get((subj, band), 0) >= 1, (subj, band)


def test_three_tap_pick():
    b = _bank()
    res = b.pick(subject="MATHS", band="B", trend="stable", tone="encouraging")
    assert len(res) >= 1 and all(t["subject"] == "MATHS" for t in res)


def test_interpolation_and_apostrophes():
    b = _bank()
    ctx = dict(CTX, name="O'Brien-Chukwu")
    p = b.preview("math-B-stable-enc", ctx)
    assert "O'Brien-Chukwu" in p["text"] and "{" not in p["text"]
    assert p["chars"] <= p["max_chars"] and not p["blocked"]
    # missing keys degrade gracefully, never crash
    p2 = b.preview("math-B-stable-enc", {"name": "Ada"})
    assert "Ada" in p2["text"]


def test_save_as_is_edited_custom():
    b = _bank()
    p = b.preview("math-B-stable-enc", CTX)
    r = b.save("math-B-stable-enc", p["text"], CTX)
    assert r["edited"] is False
    r2 = b.save("math-B-stable-enc", p["text"] + " Well done!", CTX)
    assert r2["edited"] is True
    r3 = b.save(None, "Entirely my own sentence.", CTX)
    assert r3["custom"] is True
    assert set(b.usage) == {"math-B-stable-enc"}  # counters keyed by template only


def test_overflow_blocks():
    b = _bank()
    with pytest.raises(ValueError, match="VAL-COMLEN-01"):
        b.save("math-B-stable-enc", "x" * 500, CTX)


def test_fit_all_templates_default_ctx():
    b = _bank()
    for tid in b.templates:
        p = b.preview(tid, CTX)
        assert not p["blocked"], (tid, p["chars"], p["max_chars"])
