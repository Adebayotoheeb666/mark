"""Signed updates with rollback (Phase 8 ref). Ed25519 release key; bad sig refused."""
from nacl.signing import SigningKey, VerifyKey
from nacl.exceptions import BadSignatureError

CURRENT = {"version": "0.3.0", "blob": b"hub-binary-0.3.0"}


def make_release(version, blob: bytes):
    sk = SigningKey.generate()
    return {"version": version, "blob": blob, "sig": sk.sign(blob).signature.hex(),
            "pubkey": bytes(sk.verify_key).hex()}


def apply_update(release, pubkey_hex):
    vk = VerifyKey(bytes.fromhex(pubkey_hex))
    try:
        vk.verify(release["blob"], bytes.fromhex(release["sig"]))
    except BadSignatureError:
        raise ValueError("update refused: bad signature (rollback intact)")
    prev = dict(CURRENT)
    CURRENT.update({"version": release["version"], "blob": release["blob"]})
    return prev  # rollback handle


def rollback(prev):
    CURRENT.update(prev)
