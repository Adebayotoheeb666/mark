"""Pack loader (Phase 1): weights + grading scales with VAL-WEIGHT-01 enforcement."""
import json


def load_scale(path):
    with open(path) as f:
        scale = json.load(f)
    assert isinstance(scale, list) and all("min" in r and "grade" in r for r in scale)
    return scale


def load_weights(path):
    with open(path) as f:
        w = json.load(f)
    for subj, parts in w.items():
        s = sum(p["weight"] for p in parts)
        if s != 100:
            raise ValueError(f"VAL-WEIGHT-01: {subj} weights sum to {s}%, must be 100%")
        for p in parts:
            if p["max"] <= 0 or p["weight"] < 0:
                raise ValueError("VAL-TYPE-01: bad max/weight in pack")
    return w


def subject_items(subject_code, weights, values_by_label):
    """Build [(value, max, weight)] for engine from pack weights + entered values."""
    out = []
    for part in weights[subject_code]:
        label = part["assessment"]
        if label not in values_by_label or values_by_label[label] is None:
            raise ValueError(f"VAL-MISS-01: missing {label}")
        out.append((values_by_label[label], part["max"], part["weight"]))
    return out
