"""Phase 1 tests: unit (golden vectors) + property (10k randomized) + perf."""
import itertools, json, os, random, sys, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from engine.calc import weighted_avg_tenths, map_grade, rank_positions, attendance_tenths, compute_subject
from engine.pack_loader import load_scale, load_weights, subject_items

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SCALE = load_scale(os.path.join(ROOT, "packs", "grading_scales.example.json"))
WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))


def test_golden_vectors():
    cases = [
        ([(16, 20, 20), (14, 20, 20), (45, 60, 60)], 750, "A", 75),
        ([(14, 20, 20), (14, 20, 20), (42, 60, 60)], 700, "A", 70),
        ([(0, 20, 20), (0, 20, 20), (0, 60, 60)], 0, "F", 0),
        ([(20, 20, 20), (20, 20, 20), (60, 60, 60)], 1000, "A", 100),
    ]
    for items, avg_t, grade, total in cases:
        r = compute_subject(items, SCALE)
        assert r["avg_tenths"] == avg_t, (items, r)
        assert r["grade"] == grade, (items, r)
        assert r["total"] == total, (items, r)


def test_grade_boundaries():
    assert map_grade(700, SCALE) == "A"
    assert map_grade(699, SCALE) == "B"
    assert map_grade(600, SCALE) == "B"
    assert map_grade(0, SCALE) == "F"


def test_ranks():
    assert rank_positions([900, 800, 800, 700], "competition") == [1, 2, 2, 4]
    assert rank_positions([900, 800, 800, 700], "dense") == [1, 2, 2, 3]
    assert rank_positions([500, 500, 500]) == [1, 1, 1]


def test_blocking_errors():
    import pytest
    with pytest.raises(ValueError, match="VAL-RANGE-01"):
        weighted_avg_tenths([(21, 20, 100)], None)
    with pytest.raises(ValueError, match="VAL-MISS-01"):
        weighted_avg_tenths([(None, 20, 100)], None)
    with pytest.raises(ValueError, match="VAL-WEIGHT-01"):
        weighted_avg_tenths([(10, 20, 50)], None)


def test_property_10k():
    rng = random.Random(20261016)
    for _ in range(10_000):
        maxs = [rng.choice([10, 20, 25, 30, 40, 60, 100]) for _ in range(3)]
        weights = [20, 20, 60]
        vals = [rng.randint(0, m) for m in maxs]
        items = list(zip(vals, maxs, weights))
        a = weighted_avg_tenths(items, None)
        b = weighted_avg_tenths(items, None)
        assert a == b, "determinism failed"
        assert 0 <= a <= 1000
        # permutation of equal-max parts is invariant
        if maxs[0] == maxs[1]:
            items2 = [items[1], items[0], items[2]]
            w2 = [weights[1], weights[0], weights[2]]
            assert weighted_avg_tenths(items2, None) == a


def test_perf_1000x10():
    rng = random.Random(7)
    students = [[(rng.randint(0, 20), 20, 10) for _ in range(10)] for _ in range(1000)]
    # fix weights to sum 100: 10x10
    students = [[(v, m, 10) for v, m, _ in s] for s in students]
    t0 = time.perf_counter()
    for s in students:
        compute_subject(s, SCALE)
    dt = time.perf_counter() - t0
    print(f"\nperf 1000 students x 10 assessments: {dt:.2f}s")
    assert dt < 60, f"too slow: {dt:.2f}s"
