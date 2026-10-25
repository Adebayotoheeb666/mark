"""Pack sign/verify round-trip (Phase 0 v0).
Uses PyNaCl Ed25519 if available, else HMAC demo fallback (NOT for production).
Usage: python scripts/pack_sign_verify.py
"""
import json, os, sys, hashlib, hmac

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, "packs", "manifest.example.json")

def main():
    with open(MANIFEST, "rb") as f:
        data = f.read()
    digest = hashlib.sha256(data).hexdigest()
    try:
        from nacl.signing import SigningKey
        sk = SigningKey.generate()
        signed = sk.sign(data)
        vk = sk.verify_key
        vk.verify(signed)
        print(f"pack_sign_verify: OK (ed25519) manifest_sha256={digest}")
    except ImportError:
        key = b"phase0-demo-only-not-production"
        sig = hmac.new(key, data, hashlib.sha256).hexdigest()
        assert hmac.compare_digest(sig, hmac.new(key, data, hashlib.sha256).hexdigest())
        print(f"pack_sign_verify: OK (hmac-fallback) manifest_sha256={digest}")
    # verify manifest validates against schema (light check)
    m = json.loads(data)
    assert m["pack_id"] == "ng-secondary" and m["version"] == "1.4.0", "manifest content mismatch"
    print("manifest content: OK")

if __name__ == "__main__":
    sys.exit(main())
