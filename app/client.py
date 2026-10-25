"""Teacher app reference client (Phase 6). Offline-first outbox + LAN sync to hub.
Conflict rule: server-wins; teacher re-confirms with fresh value. Idempotent op_ids.
"""
import json
import sqlite3
import uuid

import sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from engine import validate as V
from app import pairing as P


class TeacherApp:
    def __init__(self, device_id=None, max_cache=None):
        self.device_id = device_id or f"dev-{uuid.uuid4().hex[:8]}"
        self.paired = False
        self.max_cache = max_cache or {}  # (subject,label) -> max_score (from hub sheet)
        self.local = sqlite3.connect(":memory:")
        self.local.row_factory = sqlite3.Row
        self.local.executescript(
            "CREATE TABLE sheets(student TEXT, subject TEXT, label TEXT, value REAL, PRIMARY KEY(student,subject,label));"
            "CREATE TABLE outbox(op_id TEXT PRIMARY KEY, kind TEXT, payload TEXT, attempts INT DEFAULT 0, status TEXT DEFAULT 'queued');")

    def pair(self, hub_con, code, approver_role="head"):
        P.approve(hub_con, code, self.device_id, approver_role)
        self.paired = True

    def load_sheet(self, hub_con, subject):
        """Cache hub max-scores/weights so entry mirrors hub (FR-APP-003)."""
        for r in hub_con.execute("SELECT label, max_score FROM assessments WHERE subject=?", (subject,)):
            self.max_cache[(subject, r["label"])] = r["max_score"]

    def enter(self, student, subject, label, value):
        """Instant local check; queued only if valid locally."""
        maxs = self.max_cache.get((subject, label))
        if maxs is None:
            raise ValueError(f"unknown sheet {subject}/{label} — load_sheet first")
        flag = V.run_entry_checks(value, maxs, label)
        if flag and flag["severity"] == "blocking":
            raise ValueError(f"{flag['rule_id']}: {flag['message']}")
        self.local.execute("INSERT OR REPLACE INTO sheets(student,subject,label,value) VALUES(?,?,?,?)",
                           (student, subject, label, value))
        op_id = uuid.uuid4().hex
        payload = json.dumps({"student": student, "subject": subject, "label": label, "value": value})
        blob = json.dumps({"op_id": op_id, "payload": payload}).encode()
        assert len(blob) <= 256 * 1024, "payload cap 256KB exceeded"
        self.local.execute("INSERT INTO outbox(op_id,kind,payload) VALUES(?,?,?)", (op_id, "score.add", payload))
        self.local.commit()
        return op_id

    def sync(self, hub_con, actor="teacher"):
        """Push outbox in order. Returns {applied, conflicts}. Raises if unpaired/revoked."""
        if not self.paired or not P.is_paired(hub_con, self.device_id):
            raise ValueError("device not paired (or revoked) — re-pair required")
        from hub import store as S
        applied, conflicts = [], []
        for row in self.local.execute("SELECT * FROM outbox WHERE status='queued' ORDER BY rowid"):
            if P.op_applied(hub_con, row["op_id"]):
                self.local.execute("UPDATE outbox SET status='applied' WHERE op_id=?", (row["op_id"],))
                applied.append(row["op_id"])
                continue
            p = json.loads(row["payload"])
            try:
                S.add_score(hub_con, p["student"], p["subject"], p["label"], p["value"], actor)
                P.mark_applied(hub_con, row["op_id"])
                self.local.execute("UPDATE outbox SET status='applied' WHERE op_id=?", (row["op_id"],))
                applied.append(row["op_id"])
            except ValueError as e:
                msg = str(e)
                if msg.startswith("VAL-DUP-01"):
                    self.local.execute("UPDATE outbox SET status='conflict', attempts=attempts+1 WHERE op_id=?",
                                       (row["op_id"],))
                    conflicts.append({"op_id": row["op_id"], "hub": msg, "mine": p})
                else:
                    self.local.execute("UPDATE outbox SET attempts=attempts+1 WHERE op_id=?", (row["op_id"],))
                    raise
        self.local.commit()
        return {"applied": applied, "conflicts": conflicts}

    def resolve_conflict(self, hub_con, op_id, keep_hub=True, new_value=None, actor="teacher"):
        """Server-wins default; teacher may enter a fresh corrected value (new op)."""
        from hub import store as S
        row = self.local.execute("SELECT * FROM outbox WHERE op_id=?", (op_id,)).fetchone()
        if not row or row["status"] != "conflict":
            raise ValueError("no such conflict")
        p = json.loads(row["payload"])
        if keep_hub:
            hub_row = hub_con.execute(
                "SELECT value FROM scores WHERE student_code=? AND subject=? AND label=?",
                (p["student"], p["subject"], p["label"])).fetchone()
            hv = hub_row["value"] if hub_row else None
            self.local.execute("INSERT OR REPLACE INTO sheets(student,subject,label,value) VALUES(?,?,?,?)",
                               (p["student"], p["subject"], p["label"], hv))
            self.local.execute("UPDATE outbox SET status='resolved-hub' WHERE op_id=?", (op_id,))
            self.local.commit()
            return {"kept": "hub", "value": hv}
        # correct with a fresh value: supersede via hub update path on latest hub row
        cur = hub_con.execute(
            "SELECT id FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
            (p["student"], p["subject"], p["label"])).fetchone()
        nid = S.update_score(hub_con, cur["id"], new_value, actor)
        self.local.execute("UPDATE outbox SET status='resolved-mine' WHERE op_id=?", (op_id,))
        self.local.commit()
        return {"kept": "mine", "new_score_id": nid}
