"""Agent Mark comment bank (Phase 3). Teacher-controlled, no generation.
Taxonomy: subject x band x trend x tone. Placeholders interpolated, teacher edits freely.
Overflow enforced via VAL-COMLEN-01. Usage counters keyed by template_id only (no PII).
"""
import csv
from collections import Counter

PLACEHOLDERS = ("name", "subject", "score", "strength", "next_step")


class CommentBank:
    def __init__(self):
        self.templates = {}  # id -> dict
        self.usage = Counter()
        self.edited = Counter()

    def load_csv(self, path):
        with open(path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                row["max_chars"] = int(row["max_chars"])
                self.templates[row["id"]] = row
        return len(self.templates)

    def pick(self, subject=None, band=None, trend=None, tone=None, locale="en"):
        out = list(self.templates.values())
        for key, val in (("subject", subject), ("band", band), ("trend", trend),
                         ("tone", tone), ("locale", locale)):
            if val:
                out = [t for t in out if t[key] == val]
        return sorted(out, key=lambda t: t["id"])

    def interpolate(self, text, ctx):
        safe = {k: str(ctx.get(k, "")) for k in PLACEHOLDERS}
        try:
            return text.format(**safe)
        except (KeyError, IndexError, ValueError):
            out = text
            for k, v in safe.items():
                out = out.replace("{" + k + "}", v)
            return out

    def preview(self, template_id, ctx):
        t = self.templates[template_id]
        from engine.validate import check_comment_len
        text = self.interpolate(t["text"], ctx)
        flag = check_comment_len(text, t["max_chars"])
        return {"text": text, "chars": len(text), "max_chars": t["max_chars"],
                "blocked": flag is not None, "flag": flag}

    def save(self, template_id_or_none, final_text, ctx=None, author="teacher"):
        from engine.validate import check_comment_len
        tid = template_id_or_none
        template_text = self.interpolate(self.templates[tid]["text"], ctx or {}) if tid else None
        is_edited = bool(tid) and final_text != template_text
        max_chars = self.templates[tid]["max_chars"] if tid else 500
        flag = check_comment_len(final_text, max_chars)
        if flag:
            raise ValueError(f"{flag['rule_id']}: {flag['message']}")
        if tid:
            self.usage[tid] += 1
            if is_edited:
                self.edited[tid] += 1
        return {"template_id": tid, "final_text": final_text,
                "edited": is_edited if tid else None, "custom": tid is None, "author": author}

    def coverage(self):
        """(subject, band) -> count, for gap analysis."""
        cov = Counter()
        for t in self.templates.values():
            cov[(t["subject"], t["band"])] += 1
        return dict(cov)
