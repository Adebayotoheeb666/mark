"""Validate demo + schema files parse and agree (Phase 0 smoke check)."""
import json, csv, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def main():
    for p in ["demo/demo_school.json", "demo/expected_flags.json", "demo/boundary_vectors.json",
              "schemas/pack_manifest.json", "schemas/score_batch.json",
              "packs/manifest.example.json", "packs/grading_scales.example.json", "packs/weights.example.json"]:
        with open(os.path.join(ROOT, p)) as f:
            json.load(f)
        print(f"valid JSON: {p}")
    # seeded_errors.csv has header + 6 rows
    with open(os.path.join(ROOT, "demo", "seeded_errors.csv")) as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 6, f"expected 6 rows, got {len(rows)}"
    flagged = [r for r in rows if r["expect_flag"]]
    assert len(flagged) == 3, f"expected 3 flagged rows, got {len(flagged)}"
    print(f"seeded_errors.csv: OK (6 rows, 3 flagged)")
    # weights example sums to 100 per subject
    with open(os.path.join(ROOT, "packs", "weights.example.json")) as f:
        w = json.load(f)
    for subj, parts in w.items():
        s = sum(p["weight"] for p in parts)
        assert s == 100, f"{subj} weights sum {s}"
        print(f"weights {subj}: OK (sum=100)")
    print("validate_demo: ALL OK")

if __name__ == "__main__":
    sys.exit(main())
