"""Agent Mark validation engine (Phase 2). Pure functions, no I/O.
Never auto-changes data — returns flags for human disposition.
Rules: VAL-RANGE-01, VAL-TYPE-01, VAL-MISS-01, VAL-DUP-01, VAL-WEIGHT-01,
        VAL-JUMP-01, VAL-OUTLIER-01, VAL-COLSWAP-01, VAL-COMLEN-01.
"""
from dataclasses import dataclass
import statistics

ENGINE_VERSION = "0.3.0"


@dataclass(frozen=True)
class Thresholds:
    jump_pts: float = 25.0      # VAL-JUMP-01
    outlier_sd: float = 3.0     # VAL-OUTLIER-01
    version: str = "default-v1"


def _flag(rule_id, severity, message, suggestion, ref=None):
    return {"rule_id": rule_id, "severity": severity, "message": message,
            "suggestion": suggestion, "ref": ref}


def check_range(value, max_score, ref=None):
    """VAL-RANGE-01 blocking. value None handled by check_missing."""
    if value is None:
        return None
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return _flag("VAL-TYPE-01", "blocking",
                      f"'{value}' is not a number — check the entry.",
                      "Re-type the score as digits only.", ref)
    if value < 0 or value > max_score:
        return _flag("VAL-RANGE-01", "blocking",
                      f"{value} is outside 0–{max_score} — check the entry.",
                      f"Correct to a value between 0 and {max_score}.", ref)
    return None


def check_missing(value, label="Score", ref=None):
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return _flag("VAL-MISS-01", "blocking",
                      f"{label} is missing — reports cannot be printed until it is filled.",
                      "Enter the score, or confirm the student was absent with a note.", ref)
    return None


def check_duplicate(existing_values, ref=None):
    """existing_values: list of submitted values for same student+assessment."""
    vals = [v for v in existing_values if v is not None]
    if len(set(vals)) > 1:
        return _flag("VAL-DUP-01", "blocking",
                      f"Two different entries {sorted(set(vals))} exist for the same assessment.",
                      "Confirm which entry is correct; the other will be superseded (logged).", ref)
    return None


def check_weights_sum(weights, ref=None):
    s = sum(weights)
    if s != 100:
        return _flag("VAL-WEIGHT-01", "blocking",
                      f"Weights add up to {s}%, they must add up to 100%.",
                      "Fix the assessment weights in setup before locking the term.", ref)
    return None


def check_jump(current_avg, prior_mean, th: Thresholds = Thresholds(), ref=None):
    """VAL-JUMP-01 warning: |current - prior| >= threshold."""
    if prior_mean is None or current_avg is None:
        return None
    delta = current_avg - prior_mean
    if abs(delta) >= th.jump_pts:
        direction = "up" if delta > 0 else "down"
        return _flag("VAL-JUMP-01", "warning",
                      f"Average moved {direction} from {prior_mean:.1f} to {current_avg:.1f} "
                      f"(change {delta:+.1f}, threshold ±{th.jump_pts:.0f}) — please confirm.",
                      "Correct the scores if mistyped, or confirm with a reason.", ref)
    return None


def check_outlier(student_avg, class_avgs, th: Thresholds = Thresholds(), ref=None):
    """VAL-OUTLIER-01 warning, review-only. Needs >=4 classmates for a stable SD."""
    peers = [a for a in class_avgs if a is not None]
    if student_avg is None or len(peers) < 4:
        return None
    mean = statistics.fmean(peers)
    sd = statistics.pstdev(peers)
    if sd == 0:
        return None
    z = (student_avg - mean) / sd
    if abs(z) > th.outlier_sd:
        return _flag("VAL-OUTLIER-01", "warning",
                      f"{student_avg:.1f} is {abs(z):.1f} standard deviations from the class "
                      f"average {mean:.1f} — second look only, never auto-changed.",
                      "Review the entries; confirm with reason if genuinely exceptional.", ref)
    return None


def check_colswap(ca_pcts, exam_pcts, ref=None):
    """VAL-COLSWAP-01 warning: whole-class CA<<Exam inversion suggests swapped columns.
    ca_pcts/exam_pcts: per-student percentages (0-100)."""
    pairs = [(c, e) for c, e in zip(ca_pcts, exam_pcts) if c is not None and e is not None]
    if len(pairs) < 5:
        return None
    med_ca = statistics.median(c for c, _ in pairs)
    med_ex = statistics.median(e for _, e in pairs)
    inverted = sum(1 for c, e in pairs if c < e - 40) / len(pairs)
    if med_ca < 35 and med_ex > 65 and inverted >= 0.7:
        return _flag("VAL-COLSWAP-01", "warning",
                      f"Class CA median {med_ca:.0f}% is far below Exam median {med_ex:.0f}% "
                      f"({inverted:.0%} of students) — columns may be swapped.",
                      "Check whether CA and Exam columns were swapped on import/entry.", ref)
    return None


def check_comment_len(text, max_chars, ref=None):
    if text is not None and len(text) > max_chars:
        over = len(text) - max_chars
        return _flag("VAL-COMLEN-01", "blocking",
                      f"Comment is {over} characters too long for the report box "
                      f"({len(text)}/{max_chars}).",
                      "Shorten the comment or pick a shorter template.", ref)
    return None


def run_entry_checks(value, max_score, label="Score", ref=None):
    """Convenience: missing → range/type. Returns first flag or None."""
    return check_missing(value, label, ref) or check_range(value, max_score, ref)
