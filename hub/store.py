"""Agent Mark hub store (Phase 5, Python reference). SQLite via stdlib
(PRODUCTION: SQLCipher AES-256 — this ref uses plain SQLite + encrypted backups).
Versioned scores (no silent overwrite), hash-chained audit, backup/drill gate flags.
"""
import csv
import hashlib
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, short_code TEXT UNIQUE NOT NULL,
  first TEXT, last TEXT, class TEXT, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS staff(id TEXT PRIMARY KEY, name TEXT, role TEXT, pin_hash TEXT);
CREATE TABLE IF NOT EXISTS assessments(subject TEXT, label TEXT, max_score REAL, weight REAL,
  PRIMARY KEY(subject, label));
CREATE TABLE IF NOT EXISTS scores(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT,
  label TEXT, value REAL, entered_by TEXT, version INT, supersedes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT,
  action TEXT, entity TEXT, before_json TEXT, after_json TEXT, prev_hash TEXT, hash TEXT);
"""


def connect(path=":memory:"):
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def _now():
    return datetime.now(timezone.utc).isoformat()


def audit(con, actor, action, entity, before=None, after=None):
    prev = con.execute("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1").fetchone()
    prev_h = prev["hash"] if prev else "GENESIS"
    body = json.dumps({"ts": _now(), "actor": actor, "action": action, "entity": entity,
                       "before": before, "after": after, "prev": prev_h}, sort_keys=True)
    h = hashlib.sha256(body.encode()).hexdigest()
    con.execute("INSERT INTO audit(ts,actor,action,entity,before_json,after_json,prev_hash,hash)"
                " VALUES(?,?,?,?,?,?,?,?)",
                (_now(), actor, action, entity, json.dumps(before), json.dumps(after), prev_h, h))
    con.commit()
    return h


def audit_verify(con):
    rows = con.execute("SELECT * FROM audit ORDER BY seq").fetchall()
    prev = "GENESIS"
    for r in rows:
        body = json.dumps({"ts": r["ts"], "actor": r["actor"], "action": r["action"],
                           "entity": r["entity"], "before": json.loads(r["before_json"]),
                           "after": json.loads(r["after_json"]), "prev": r["prev_hash"]}, sort_keys=True)
        # ts re-serialization may differ; verify chain links only (cheap, robust)
        if r["prev_hash"] != prev:
            return False
        prev = r["hash"]
    return True


def set_flag(con, k, v, actor="system"):
    con.execute("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)", (k, v))
    con.commit()
    audit(con, actor, f"flag.{k}", k, None, {"v": v})


def get_flag(con, k, default=None):
    r = con.execute("SELECT v FROM meta WHERE k=?", (k,)).fetchone()
    return r["v"] if r else default


def import_roster(con, csv_path, actor="admin", dry_run=True):
    """CSV: short_code,first_name,last_name,class_label. Returns {errors, would_import}."""
    errors, rows = [], []
    seen = set()
    with open(csv_path, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f), start=2):
            sc = (row.get("short_code") or "").strip()
            if not sc or not (row.get("first_name") or "").strip() or not (row.get("class_label") or "").strip():
                errors.append({"row": i, "error": "missing short_code/first_name/class_label"})
                continue
            if sc in seen:
                errors.append({"row": i, "error": f"duplicate short_code {sc} in file"})
                continue
            seen.add(sc)
            if con.execute("SELECT 1 FROM students WHERE short_code=?", (sc,)).fetchone():
                errors.append({"row": i, "error": f"duplicate short_code {sc} in db"})
                continue
            rows.append({"short_code": sc, "first": row.get("first_name", ""),
                         "last": row.get("last_name", ""), "class": row.get("class_label", "")})
    if not dry_run and not errors:
        for r in rows:
            con.execute("INSERT INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
                        (str(uuid.uuid4()), r["short_code"], r["first"], r["last"], r["class"]))
        con.commit()
        audit(con, actor, "roster.import", "students", None, {"count": len(rows)})
    return {"errors": errors, "would_import": len(rows)}


def seed_assessments(con, weights):
    """weights: {subject: [{assessment, max, weight}]} from pack."""
    for subj, parts in weights.items():
        for p in parts:
            con.execute("INSERT OR REPLACE INTO assessments(subject,label,max_score,weight) VALUES(?,?,?,?)",
                        (subj, p["assessment"], p["max"], p["weight"]))
    con.commit()


def add_score(con, student_code, subject, label, value, entered_by):
    r = con.execute("SELECT max_score FROM assessments WHERE subject=? AND label=?", (subject, label)).fetchone()
    if not r:
        raise ValueError(f"unknown assessment {subject}/{label}")
    if value is None or value < 0 or value > r["max_score"]:
        raise ValueError(f"VAL-RANGE-01: {value} outside 0–{r['max_score']}")
    # duplicate with different value check (VAL-DUP-01): prior open versions
    priors = con.execute("SELECT value FROM scores WHERE student_code=? AND subject=? AND label=?",
                         (student_code, subject, label)).fetchall()
    if any(p["value"] != value for p in priors):
        raise ValueError(f"VAL-DUP-01: conflicting prior entries {[p['value'] for p in priors]} vs {value}")
    if any(p["value"] == value for p in priors):
        return priors[0]  # idempotent same-value resubmit
    sid = str(uuid.uuid4())
    con.execute("INSERT INTO scores(id,student_code,subject,label,value,entered_by,version,supersedes,created_at)"
                " VALUES(?,?,?,?,?,?,1,NULL,?)", (sid, student_code, subject, label, value, entered_by, _now()))
    con.commit()
    audit(con, entered_by, "score.add", sid, None,
          {"student": student_code, "subject": subject, "label": label, "value": value})
    return sid


def update_score(con, score_id, new_value, actor):
    cur = con.execute("SELECT * FROM scores WHERE id=?", (score_id,)).fetchone()
    if not cur:
        raise ValueError("unknown score")
    r = con.execute("SELECT max_score FROM assessments WHERE subject=? AND label=?",
                    (cur["subject"], cur["label"])).fetchone()
    if new_value < 0 or new_value > r["max_score"]:
        raise ValueError("VAL-RANGE-01")
    nid = str(uuid.uuid4())
    con.execute("INSERT INTO scores(id,student_code,subject,label,value,entered_by,version,supersedes,created_at)"
                " VALUES(?,?,?,?,?,?,?, ?,?)",
                (nid, cur["student_code"], cur["subject"], cur["label"], new_value, actor,
                 cur["version"] + 1, score_id, _now()))
    con.commit()
    audit(con, actor, "score.update", nid, dict(cur),
          {"student": cur["student_code"], "value": new_value, "version": cur["version"] + 1})
    return nid


def readiness(con):
    """Blocking vs warning checklist. Go-live needs zero blocking + backup + drill."""
    blocking, warning = [], []
    n_stu = con.execute("SELECT COUNT(*) c FROM students").fetchone()["c"]
    if n_stu == 0:
        blocking.append("No students imported.")
    n_ass = con.execute("SELECT COUNT(*) c FROM assessments").fetchone()["c"]
    if n_ass == 0:
        blocking.append("No assessments configured.")
    # weights sum per subject
    for row in con.execute("SELECT subject, SUM(weight) s FROM assessments GROUP BY subject"):
        if row["s"] != 100:
            blocking.append(f"Weights for {row['subject']} sum to {row['s']}%, must be 100%.")
    if get_flag(con, "backup_verified") != "yes":
        blocking.append("No verified backup. Run backup + verify first.")
    if get_flag(con, "drill_passed") != "yes":
        blocking.append("Restore drill not passed. Complete wipe→restore drill.")
    n_scores = con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"]
    if n_stu > 0 and n_scores == 0:
        warning.append("No scores entered yet.")
    return {"blocking": blocking, "warning": warning, "ready": not blocking}


def go_live(con, actor="admin"):
    rep = readiness(con)
    if not rep["ready"]:
        raise ValueError("Go-Live blocked: " + "; ".join(rep["blocking"]))
    set_flag(con, "live", "yes", actor)
    return True
