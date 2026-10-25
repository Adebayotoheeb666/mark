"""Flag inbox store (Phase 2). In-memory now; SQLite port in Phase 5 keeps same API.
Lifecycle: open -> corrected | confirmed-with-reason | escalated -> resolved.
Confirm requires a reason. No auto-mutation of scores anywhere in this module.
"""
import itertools
from datetime import datetime, timezone

STATUSES = ("open", "resolved")
DISPOSITIONS = ("corrected", "confirmed", "escalated")


class FlagStore:
    def __init__(self):
        self._flags = {}
        self._ids = itertools.count(1)
        self.audit = []

    def raise_flag(self, flag, student_code=None, subject=None, assignee=None):
        fid = f"F{next(self._ids):04d}"
        rec = {"flag_id": fid, "status": "open", "disposition": None,
               "student_code": student_code, "subject": subject, "assignee": assignee,
               "resolved_by": None, "resolved_at": None, "note": None, **flag}
        self._flags[fid] = rec
        self.audit.append({"ts": _now(), "actor": "system", "action": "flag.raise",
                           "flag_id": fid, "rule": flag["rule_id"]})
        return rec

    def list(self, severity=None, subject=None, status="open"):
        out = list(self._flags.values())
        if status:
            out = [f for f in out if f["status"] == status]
        if severity:
            out = [f for f in out if f["severity"] == severity]
        if subject:
            out = [f for f in out if f["subject"] == subject]
        return sorted(out, key=lambda f: (f["severity"] != "blocking", f["flag_id"]))

    def dispose(self, flag_id, disposition, actor, note=""):
        if disposition not in DISPOSITIONS:
            raise ValueError(f"unknown disposition {disposition}")
        rec = self._flags[flag_id]
        if rec["status"] != "open":
            raise ValueError("flag already resolved")
        if disposition == "confirmed" and not (note or "").strip():
            raise ValueError("confirmed disposition requires a reason note")
        rec.update({"status": "resolved", "disposition": disposition,
                    "resolved_by": actor, "resolved_at": _now(), "note": note})
        self.audit.append({"ts": _now(), "actor": actor, "action": f"flag.{disposition}",
                           "flag_id": flag_id, "note": note})
        return rec


def _now():
    return datetime.now(timezone.utc).isoformat()
