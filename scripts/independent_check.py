"""Independent re-implementation spot-check (Phase 1 gate).
Naive float-based calc written separately from engine/calc.py (Fraction-based).
Compares 100 random cases: total + grade must match 100%; avg within 0.05.
Writes engine/testdata/independent_check.csv
"""
import csv, os, random, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from engine.calc import compute_subject
from engine.pack_loader import load_scale

SCALE = load_scale(os.path.join(ROOT, "packs", "grading_scales.example.json"))

def naive(items, scale):
    total = sum(v for v, _, _ in items)
    avg = sum(v / m * w for v, m, w in items)
    for row in sorted(scale, key=lambda r: r["min"], reverse=True):
        if round(avg + 1e-9, 1) >= row["min"]:
            grade = row["grade"]
            break
    return total, avg, grade

def main(n=100):
    rng = random.Random(99)
    mism = 0
    out = os.path.join(ROOT, "engine", "testdata", "independent_check.csv")
    with open(out, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["i", "avg_engine", "avg_naive", "grade_engine", "grade_naive", "match"])
        for i in range(n):
            maxs = [rng.choice([10, 20, 25, 30, 40, 60, 100]) for _ in range(3)]
            vals = [rng.randint(0, m) for m in maxs]
            items = list(zip(vals, maxs, [20, 20, 60]))
            r = compute_subject(items, SCALE)
            t2, a2, g2 = naive(items, SCALE)
            ok = (r["total"] == t2 and r["grade"] == g2 and abs(r["avg"] - a2) < 0.051)
            if not ok:
                mism += 1
            w.writerow([i, f"{r['avg']:.1f}", f"{a2:.1f}", r["grade"], g2, int(ok)])
    print(f"independent_check: {n - mism}/{n} match (total+grade exact, avg tol 0.05)")
    assert mism == 0, f"{mism} mismatches — see {out}"
    print("INDEPENDENT CHECK PASSED (100% match)")

if __name__ == "__main__":
    main()
