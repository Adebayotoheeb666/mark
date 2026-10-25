"""Phase 7 tests: E2E round-trip, TTL, opacity, rate-limit, idempotency, outage."""
import json
import os, sys
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, ROOT)
from relay import store as RS
from relay import crypto as C
from hub import store as S
from engine.pack_loader import load_weights

WEIGHTS = load_weights(os.path.join(ROOT, "packs", "weights.example.json"))
HUB_ID = "hub-test-001"


def test_seal_roundtrip_and_wrong_key_fails():
    priv, pub = C.generate_hub_keys()
    priv2, _ = C.generate_hub_keys()
    ct = C.seal(pub, b'{"student": "26-JSS2A-001", "value": 17}')
    assert C.unseal(priv, ct) == b'{"student": "26-JSS2A-001", "value": 17}'
    with pytest.raises(Exception):
        C.unseal(priv2, ct)


def test_post_poll_ack_grace_and_ttl():
    r = RS.Relay()
    priv, pub = C.generate_hub_keys()
    msg = json.dumps({"op_id": "op1", "student": "S1", "value": 15}).encode()
    meta = r.post(HUB_ID, C.seal(pub, msg), ttl=3600, now=1000.0)
    assert meta["expires_at"] == pytest.approx(1000.0 + 3600)
    assert len(r.list_for_hub(HUB_ID, now=1001.0)) == 1
    r.ack(meta["id"], now=1100.0)
    assert r.env[meta["id"]]["expires"] == pytest.approx(1100.0 + RS.GRACE_TTL)
    assert r.sweep(now=1100.0 + RS.GRACE_TTL + 1) == [meta["id"]]
    # unclaimed 30d default
    m2 = r.post(HUB_ID, C.seal(pub, msg), now=0.0)
    assert m2["expires_at"] == pytest.approx(RS.UNCLAIMED_TTL)


def test_opacity_no_pii_in_relay():
    r = RS.Relay()
    priv, pub = C.generate_hub_keys()
    payload = json.dumps({"op_id": "op9", "student": "Ada Lovelace 26-JSS2A-001",
                          "subject": "MATHS", "value": 99}).encode()
    eid = r.post(HUB_ID, C.seal(pub, payload))["id"]
    meta = {k: {kk: (vv.hex() if isinstance(vv, bytes) else vv)
                for kk, vv in v.items() if kk != "blob"}
            for k, v in r.env.items()}
    dump = json.dumps({"env": meta}) + json.dumps(r.log) + r.fetch(eid).hex()
    for secret in ("Ada", "Lovelace", "26-JSS2A-001", "MATHS", "99"):
        if secret == "99":
            continue  # short numerics may collide with sizes; check names/subjects strictly
        assert secret not in dump.replace(r.fetch(eid).hex(), ""), secret
    # operator with relay dump but no hub key cannot recover
    _, wrong_pub = C.generate_hub_keys()
    import nacl.public, nacl.exceptions
    with pytest.raises(Exception):
        C.unseal(bytes(__import__("nacl").public.PrivateKey.generate()), r.fetch(eid))


def test_rate_limit_and_size_cap():
    r = RS.Relay()
    _, pub = C.generate_hub_keys()
    blob = C.seal(pub, b"x")
    with pytest.raises(ValueError, match="too large"):
        r.post(HUB_ID, b"y" * (RS.MAX_BYTES + 1))
    r2 = RS.Relay()
    for _ in range(RS.DAILY_CAP):
        r2.post(HUB_ID, blob, now=5000.0)
    with pytest.raises(ValueError, match="429"):
        r2.post(HUB_ID, blob, now=5000.0)


def test_remote_teacher_via_relay_applies_once():
    r = RS.Relay()
    priv, pub = C.generate_hub_keys()
    con = S.connect()
    S.seed_assessments(con, {"MATHS": WEIGHTS["MATHS"]})

    def apply(hub_con, msg):
        S.add_score(hub_con, msg["student"], "MATHS", "CA1", msg["value"], "remote-teacher")

    msg = {"op_id": "remote-op-1", "student": "S9", "value": 16}
    r.post(HUB_ID, C.seal(pub, json.dumps(msg).encode()))
    got = RS.hub_poll(con, r, priv, HUB_ID, apply)
    assert len(got) == 1
    assert con.execute("SELECT value v FROM scores").fetchone()["v"] == 16
    # duplicate delivery (retry before sweep): idempotent, still one row
    r.post(HUB_ID, C.seal(pub, json.dumps(msg).encode()))
    RS.hub_poll(con, r, priv, HUB_ID, apply)
    assert con.execute("SELECT COUNT(*) c FROM scores").fetchone()["c"] == 1


def test_relay_outage_leaves_local_compute_unaffected():
    from engine.calc import compute_subject
    from engine.pack_loader import load_scale
    scale = load_scale(os.path.join(ROOT, "packs", "grading_scales.example.json"))
    r = RS.Relay()
    r.down = True
    with pytest.raises(ConnectionError):
        r.post(HUB_ID, b"x")
    res = compute_subject([(16, 20, 20), (14, 20, 20), (45, 60, 60)], scale)
    assert res["grade"] == "A"  # local compute + print path needs no relay
