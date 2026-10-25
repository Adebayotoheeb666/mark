"""Agent Mark runnable demo (synthetic data only). Full term cycle in one command.
Usage: python run_demo.py
Outputs: console summary + HTML reports in demo/output/ + backup in demo/output/backups/
"""
import csv
import json
import os
import shutil
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)

from hub import store as S
from hub import backup as B
from engine.pack_loader import load_scale, load_weights, subject_items
from engine.calc import compute_subject, rank_positions, explain
from engine import validate as V
from engine.flags import FlagStore
from engine.comments import CommentBank
from engine import reports as R

OUT = os.path.join(ROOT, "demo", "output")
DB = os.path.join(OUT, "hub_demo.db")
SCALE = load_scale(os.path.join(ROOT, "packs", "grading_scales.example.json"))
WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    t0 = time.perf_counter()
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(os.path.join(OUT, "backups"), exist_ok=True)

    # 1. Hub + roster
    con = S.connect(DB)
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"], "ENG": WEIGHTS["ENG"]})
    roster = os.path.join(OUT, "roster.csv")
    with open(roster, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["short_code", "first_name", "last_name", "class_label"])
        for i, name in enumerate(["Ada", "Bola", "Chidi", "Dola", "Emeka", "Funmi"], start=1):
            w.writerow([f"26-JSS2A-{i:03d}", name, "Demo", "JSS2-A"])
    rep = S.import_roster(con, roster, dry_run=False)
    print(f"[1] Roster imported: {rep['would_import']} students, errors={rep['errors']}")

    # 2. Scores (one deliberate over-max to show blocking flag)
    entries = {
        "26-JSS2A-001": {"MATHS": {"CA1": 16, "CA2": 14, "Exam": 45}, "ENG": {"CA": 32, "Exam": 48}},
        "26-JSS2A-002": {"MATHS": {"CA1": 12, "CA2": 15, "Exam": 40}, "ENG": {"CA": 28, "Exam": 44}},
        "26-JSS2A-003": {"MATHS": {"CA1": 18, "CA2": 17, "Exam": 55}, "ENG": {"CA": 36, "Exam": 52}},
        "26-JSS2A-004": {"MATHS": {"CA1": 8, "CA2": 9, "Exam": 30}, "ENG": {"CA": 20, "Exam": 35}},
        "26-JSS2A-005": {"MATHS": {"CA1": 14, "CA2": 13, "Exam": 42}, "ENG": {"CA": 30, "Exam": 46}},
        "26-JSS2A-006": {"MATHS": {"CA1": 25, "CA2": 14, "Exam": 45}, "ENG": {"CA": 31, "Exam": 47}},  # CA1 over max 20
    }
    store = FlagStore()
    ok, blocked = 0, 0
    for sc, subjs in entries.items():
        for subj, vals in subjs.items():
            for label, val in vals.items():
                maxs = next(p["max"] for p in WEIGHTS[subj] if p["assessment"] == label)
                flag = V.run_entry_checks(val, maxs, label)
                if flag and flag["severity"] == "blocking":
                    store.raise_flag(flag, student_code=sc, subject=subj)
                    blocked += 1
                    continue
                S.add_score(con, sc, subj, label, val, "demo-teacher")
                ok += 1
    print(f"[2] Scores: {ok} accepted, {blocked} blocked (see flag inbox below)")
    for f in store.list():
        print(f"    {f['flag_id']} [{f['severity']}] {f['student_code']} {f['subject']}: {f['message']}")
    # teacher corrects the bad entry
    S.add_score(con, "26-JSS2A-006", "MATHS", "CA1", 15, "demo-teacher")
    store.dispose(store.list()[0]["flag_id"], "corrected", actor="demo-teacher", note="Fixed 25 -> 15.")
    print("[2] Teacher corrected 26-JSS2A-006 CA1 25 -> 15 (flag resolved as corrected)")

    # 3. Compute + ranks
    results, avgs = {}, {}
    for sc in entries:
        results[sc] = {}
        for subj in ("MATHS", "ENG"):
            items = subject_items(subj, WEIGHTS, entries[sc][subj] if not (sc == "26-JSS2A-006" and subj == "MATHS")
                                  else {"CA1": 15, "CA2": 14, "Exam": 45})
            r = compute_subject(items, SCALE)
            results[sc][subj] = r
        avgs[sc] = sum(results[sc][s]["avg"] for s in ("MATHS", "ENG")) / 2
    order = rank_positions([avgs[f"26-JSS2A-{i:03d}"] for i in range(1, 7)])
    print("[3] Class averages + positions:")
    for i in range(1, 7):
        sc = f"26-JSS2A-{i:03d}"
        print(f"    {sc}: MATHS {results[sc]['MATHS']['avg']:.1f}%({results[sc]['MATHS']['grade']}) "
              f"ENG {results[sc]['ENG']['avg']:.1f}%({results[sc]['ENG']['grade']}) "
              f"overall {avgs[sc]:.1f}% position {order[i-1]} — {explain(results[sc]['MATHS'])}")

    # 4. Comments
    bank = CommentBank()
    bank.load_csv(os.path.join(ROOT, "packs", "comments.example.csv"))
    comments = {}
    for sc in entries:
        comments[sc] = {}
        for subj in ("MATHS", "ENG"):
            grade = results[sc][subj]["grade"]
            band = grade if grade in "ABCDF" else "C"
            opts = bank.pick(subject=subj, band=band)
            t = opts[0]
            ctx = {"name": sc, "subject": subj, "score": f"{results[sc][subj]['avg']:.1f}",
                   "strength": "problem solving", "next_step": "daily practice"}
            comments[sc][subj] = bank.preview(t["id"], ctx)["text"]
    print(f"[4] Comments drafted from bank ({len(bank.templates)} templates, coverage {bank.coverage()})")

    # 5. Reports: draft -> review -> lock -> HTML files
    snap, snap_hash = R.snapshot_results(
        {sc: {s: {"total": results[sc][s]["total"], "avg_tenths": results[sc][s]["avg_tenths"],
                  "avg": results[sc][s]["avg"], "grade": results[sc][s]["grade"]} for s in ("MATHS", "ENG")}
         for sc in entries})
    files = []
    for sc in entries:
        res = {s: {"total": results[sc][s]["total"], "avg_tenths": results[sc][s]["avg_tenths"],
                   "avg": results[sc][s]["avg"], "grade": results[sc][s]["grade"]} for s in ("MATHS", "ENG")}
        d = R.draft_report(sc, "1T-26", "JSS2-A", res,
                           {"MATHS": comments[sc]["MATHS"], "ENG": comments[sc]["ENG"]},
                           snap_hash, "engine 0.3.0 + ng-secondary 1.4.0")
        R.teacher_review(d, "Mrs. Ade")
        locked = R.head_approve_and_lock(d, "Mr. Head", snap_hash)
        assert R.verify(locked)
        fn = R.batch_filename("26", "1T", "JSS2-A", sc).replace(".pdf", ".html")
        with open(os.path.join(OUT, fn), "w", encoding="utf-8") as f:
            f.write(R.render_html(locked))
        files.append(fn)
    print(f"[5] Reports locked + verified: {len(files)} HTML files in demo/output/ (e.g., {files[0]})")

    # 6. Backup + drill
    key = B.generate_data_key()
    with open(os.path.join(OUT, "backups", "school_data.key"), "wb") as f:
        f.write(key)
    man = B.create_backup(con, key, os.path.join(OUT, "backups", "term_backup.agm"))
    art = B.drill(con, key, os.path.join(OUT, "backups", "drill"))
    print(f"[6] Backup {man['backup_id']} ({man['counts']}) + drill {art['result']}; Go-Live ready: {S.go_live(con)}")

    dt = time.perf_counter() - t0
    print(f"\nDONE in {dt:.1f}s. Open demo/output/{files[0]} in your browser to inspect a report.")
    print("Full test suite: python -m pytest hub/tests relay/tests app/tests engine/tests -q")


if __name__ == "__main__":
    main()
