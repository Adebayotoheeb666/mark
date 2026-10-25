"""Agent Mark report generator (Phase 4). Tamper-evident, approval-gated.
Integrity: REP-INT-01 (edit invalidates draft), REP-INT-02 (mismatch aborts),
REP-INT-03 (unapproved => DRAFT watermark, no signature).
Signing: Ed25519 via PyNaCl if present, else HMAC demo fallback (NOT production).
"""
import copy
import hashlib
import hmac
import json

TEMPLATE_VER = "ng-secondary-rep@1.4.0"
SIGN_MODE = None
_signer = None
_verifier = None

try:
    from nacl.signing import SigningKey as _SK
    _sk = _SK.generate()
    _vk = _sk.verify_key
    SIGN_MODE = "ed25519"

    def _sign(b: bytes) -> str:
        return _sk.sign(b).signature.hex()

    def _verify(b: bytes, sig: str) -> bool:
        try:
            _vk.verify(b, bytes.fromhex(sig))
            return True
        except Exception:
            return False
except ImportError:  # demo fallback
    SIGN_MODE = "hmac-demo"
    _KEY = b"phase4-demo-only-not-production"

    def _sign(b: bytes) -> str:
        return hmac.new(_KEY, b, hashlib.sha256).hexdigest()

    def _verify(b: bytes, sig: str) -> bool:
        return hmac.compare_digest(_sign(b), sig)


def snapshot_results(results):
    """Freeze {student_code: {subject: {total, avg_tenths, grade}}} + snapshot hash."""
    snap = copy.deepcopy(results)
    blob = json.dumps(snap, sort_keys=True).encode()
    return snap, "sha256:" + hashlib.sha256(blob).hexdigest()


def _report_hash(payload: dict) -> str:
    blob = json.dumps(payload, sort_keys=True).encode()
    return "sha256:" + hashlib.sha256(blob).hexdigest()


def draft_report(student_code, term, class_label, subject_results, comments,
                 snapshot_hash, rule_version, version=1):
    """subject_results: {subject: {total, avg_tenths, avg, grade}}. No signature yet."""
    payload = {"student_code": student_code, "term": term, "class": class_label,
               "results": subject_results, "comments": comments,
               "template_ver": TEMPLATE_VER, "rule_version": rule_version,
               "snapshot": snapshot_hash, "version": version}
    rid = f"RPT-{term}-{student_code}-v{version}"
    return {"report_id": rid, "status": "draft", "watermark": "DRAFT — NOT OFFICIAL",
            "approvals": [], "signature": None, "hash": _report_hash(payload),
            "qr": None, "payload": payload}


def render_html(report):
    """Printable HTML. Draft carries watermark; locked carries footer + hash."""
    p = report["payload"]
    rows = "".join(
        f"<tr><td>{sub}</td><td>{r['total']}</td><td>{r['avg']:.1f}</td><td>{r['grade']}</td></tr>"
        for sub, r in sorted(p["results"].items()))
    comments = "".join(f"<p><b>{sub}:</b> {c}</p>" for sub, c in sorted(p["comments"].items()))
    wm = f"<div class='watermark'>{report['watermark']}</div>" if report["status"] != "locked" else ""
    footer = (f"Report {report['report_id']} · {p['class']} · {p['term']} · "
              f"Rules {p['rule_version']} · Pack {p['template_ver']} · "
              f"Hash {report['hash'][:19]} · Approved {', '.join(a['by'] for a in report['approvals'])}"
              if report["status"] == "locked" else "DRAFT — approvals pending")
    return (f"<html><body>{wm}<h1>Report Card — {p['student_code']}</h1>"
            f"<table><tr><th>Subject</th><th>Total</th><th>Avg</th><th>Grade</th></tr>{rows}</table>"
            f"{comments}<hr><small>{footer}</small></body></html>")


def teacher_review(report, teacher):
    assert report["status"] == "draft", "must be draft"
    report["approvals"].append({"by": teacher, "role": "teacher"})
    report["status"] = "reviewed"
    return report


def head_approve_and_lock(report, head, snapshot_hash_now):
    """REP-INT-01/02: snapshot must match draft snapshot; approvals complete."""
    if report["payload"]["snapshot"] != snapshot_hash_now:
        raise ValueError("REP-INT-01: source changed since draft — regenerate required")
    roles = [a["role"] for a in report["approvals"]]
    if "teacher" not in roles:
        raise ValueError("REP-INT-03: teacher review missing — cannot lock")
    report["approvals"].append({"by": head, "role": "head"})
    report["status"] = "locked"
    report.pop("watermark", None)
    blob = json.dumps(report["payload"], sort_keys=True).encode()
    report["signature"] = _sign(blob)
    report["qr"] = f"AGM1:{report['report_id']}:{report['hash']}:{report['signature']}"
    return report


def verify(report):
    """Recompute hash + check signature. Returns True/False."""
    if report["status"] != "locked" or not report["signature"]:
        return False
    if _report_hash(report["payload"]) != report["hash"]:
        return False
    blob = json.dumps(report["payload"], sort_keys=True).encode()
    return _verify(blob, report["signature"])


def batch_filename(year, term, class_label, student_code):
    cls = class_label.replace(" ", "")
    return f"{year}_{term}_{cls}_{student_code}.pdf"


def correct_report(locked_report, fixed_results, fixed_comments, snapshot_hash):
    """New version; approvals reset; must be re-reviewed and re-locked."""
    p = locked_report["payload"]
    return draft_report(p["student_code"], p["term"], p["class"], fixed_results,
                        fixed_comments, snapshot_hash, p["rule_version"],
                        version=p["version"] + 1)
