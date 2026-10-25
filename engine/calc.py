"""Agent Mark deterministic calculation engine (Phase 1).
Pure module: no I/O, no network, no wall-clock. Integer-tenths for averages.
Rules: CALC-WAVG-01, CALC-GRADE-01, CALC-RANK-01, CALC-ROUND-01, CALC-ATT-01.
"""
from fractions import Fraction

ENGINE_VERSION = "0.3.0"
RULE_IDS = {
    "wavg": "CALC-WAVG-01",
    "grade": "CALC-GRADE-01",
    "rank": "CALC-RANK-01",
    "round": "CALC-ROUND-01",
    "att": "CALC-ATT-01",
}


def _round_half_up_frac(fr: Fraction) -> int:
    """Round non-negative Fraction to nearest int, halves up."""
    n, d = fr.numerator, fr.denominator
    return (n * 2 + d) // (2 * d)


def weighted_avg_tenths(scores, weights):
    """scores: [value,...], weights: [weight_pct,...], maxs: passed as scores tuples?

    Preferred signature: list of (value, max_score, weight_pct).
    Returns avg in tenths (685 == 68.5%). Raises ValueError on bad input.
    """
    items = list(scores)
    if not items:
        raise ValueError("VAL-MISS-01: no assessments provided")
    total_w = 0
    acc = Fraction(0, 1)
    for value, max_score, weight in items:
        if max_score is None or max_score <= 0:
            raise ValueError("VAL-TYPE-01: max_score must be > 0")
        if value is None:
            raise ValueError("VAL-MISS-01: missing score")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError("VAL-TYPE-01: non-numeric score")
        if value < 0 or value > max_score:
            raise ValueError("VAL-RANGE-01: score out of range")
        if weight < 0:
            raise ValueError("VAL-TYPE-01: negative weight")
        total_w += weight
        acc += Fraction(str(value)) / Fraction(str(max_score)) * Fraction(weight * 10, 1)
    if total_w != 100:
        raise ValueError(f"VAL-WEIGHT-01: weights sum to {total_w}%, must be 100%")
    return _round_half_up_frac(acc)


def map_grade(avg_tenths, scale):
    """scale: [{min:int pct, grade:str}] unsorted ok. Returns grade string."""
    if avg_tenths is None or avg_tenths < 0:
        raise ValueError("VAL-TYPE-01: invalid average")
    ordered = sorted(scale, key=lambda r: r["min"], reverse=True)
    for row in ordered:
        if avg_tenths >= row["min"] * 10:
            return row["grade"]
    return ordered[-1]["grade"]


def rank_positions(avgs, mode="competition"):
    """avgs: list of comparable numbers (tenths). Returns list of positions.
    competition ("1224"): 1 + count(strictly greater). dense: 1 + count(distinct greater).
    """
    if mode not in ("competition", "dense"):
        raise ValueError("unknown rank mode")
    if mode == "competition":
        return [1 + sum(1 for x in avgs if x > a) for a in avgs]
    distinct_sorted = sorted(set(avgs), reverse=True)
    order = {v: i + 1 for i, v in enumerate(distinct_sorted)}
    return [order[a] for a in avgs]


def attendance_tenths(present, total):
    if total <= 0:
        raise ValueError("VAL-TYPE-01: attendance total must be > 0")
    if present < 0 or present > total:
        raise ValueError("VAL-RANGE-01: attendance out of range")
    return _round_half_up_frac(Fraction(present * 1000, total))


def compute_subject(scores_items, scale, rule_pack="ng-secondary@1.4.0"):
    """scores_items: [(value, max, weight)]. Returns dict with total/avg/grade + provenance."""
    total = sum(v for v, _, _ in scores_items)
    avg_t = weighted_avg_tenths(scores_items, None)
    grade = map_grade(avg_t, scale)
    rule_version = f"engine {ENGINE_VERSION} + {rule_pack}"
    import hashlib
    h = hashlib.sha256(f"{scores_items}|{avg_t}|{grade}".encode()).hexdigest()
    return {
        "total": total,
        "avg_tenths": avg_t,
        "avg": avg_t / 10.0,
        "grade": grade,
        "rule_version": rule_version,
        "input_hash": f"sha256:{h[:16]}",
        "rules": RULE_IDS,
    }


def explain(result):
    """Plain-language provenance for UX-002 'Why this grade?'."""
    return (
        f"Total {result['total']}, average {result['avg']:.1f}% "
        f"({RULE_IDS['wavg']}, {RULE_IDS['round']}) → grade {result['grade']} "
        f"({RULE_IDS['grade']}) under {result['rule_version']}."
    )
