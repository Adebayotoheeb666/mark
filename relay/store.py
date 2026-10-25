"""Opaque relay store (Phase 7 ref). Ciphertext-only; minimal metadata; TTL sweep; rate limits.
Defaults: 30-day unclaimed TTL, 7-day grace after ACK. Test overrides allowed.
"""
import time
import uuid

UNCLAIMED_TTL = 30 * 24 * 3600
GRACE_TTL = 7 * 24 * 3600
MAX_BYTES = 256 * 1024
DAILY_CAP = 500


class Relay:
    def __init__(self):
        self.env = {}   # id -> {for_hub, size, created, expires, acked_at, blob}
        self.log = []   # aggregate only: {ts, hub_fp, size, action}
        self.day_counts = {}
        self.down = False  # chaos switch

    def _fp(self, for_hub):
        import hashlib
        return hashlib.sha256(for_hub.encode() if isinstance(for_hub, str) else for_hub).hexdigest()[:12]

    def post(self, for_hub, blob: bytes, ttl=UNCLAIMED_TTL, now=None):
        if self.down:
            raise ConnectionError("relay unreachable")
        if len(blob) > MAX_BYTES:
            raise ValueError("429: envelope too large")
        now = now if now is not None else time.time()
        day = (for_hub, int(now // 86400))
        if self.day_counts.get(day, 0) >= DAILY_CAP:
            raise ValueError("429: daily cap exceeded")
        self.day_counts[day] = self.day_counts.get(day, 0) + 1
        eid = uuid.uuid4().hex
        self.env[eid] = {"for_hub": for_hub if isinstance(for_hub, str) else for_hub.hex(),
                         "size": len(blob), "created": now, "expires": now + ttl,
                         "acked_at": None, "blob": bytes(blob)}
        self.log.append({"ts": now, "hub": self._fp(for_hub), "size": len(blob), "action": "post"})
        return {"id": eid, "expires_at": now + ttl}

    def list_for_hub(self, for_hub, now=None):
        if self.down:
            raise ConnectionError("relay unreachable")
        now = now if now is not None else time.time()
        key = for_hub if isinstance(for_hub, str) else for_hub.hex()
        return [{"id": k, "size": v["size"], "created": v["created"], "expires": v["expires"]}
                for k, v in self.env.items() if v["for_hub"] == key and v["expires"] > now]

    def fetch(self, eid):
        return self.env[eid]["blob"]

    def ack(self, eid, now=None):
        now = now if now is not None else time.time()
        self.env[eid]["acked_at"] = now
        self.env[eid]["expires"] = now + GRACE_TTL  # shorten to grace window
        self.log.append({"ts": now, "hub": "?", "size": self.env[eid]["size"], "action": "ack"})

    def delete(self, eid):
        self.env.pop(eid, None)

    def sweep(self, now=None):
        now = now if now is not None else time.time()
        expired = [k for k, v in self.env.items() if v["expires"] <= now]
        for k in expired:
            del self.env[k]
        return expired


def hub_poll(hub_con, relay: Relay, hub_privkey: bytes, for_hub: str, apply_fn, now=None):
    """Pull sealed envelopes, decrypt locally, apply idempotently, ACK. Returns applied ids."""
    from relay.crypto import unseal
    import json
    from app import pairing as P
    applied = []
    for meta in relay.list_for_hub(for_hub, now=now):
        blob = relay.fetch(meta["id"])
        plain = unseal(hub_privkey, blob)  # decrypt on hub only
        msg = json.loads(plain.decode())
        if not P.op_applied(hub_con, msg["op_id"]):
            apply_fn(hub_con, msg)
            P.mark_applied(hub_con, msg["op_id"])
        applied.append(meta["id"])
        relay.ack(meta["id"], now=now)
    return applied
