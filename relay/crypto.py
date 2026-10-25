"""Sealed envelopes (Phase 7). X25519 + XSalsa20-Poly1305 via PyNaCl SealedBox.
Hub keypair generated on-site; private key never leaves hub. Relay sees only ciphertext.
"""
from nacl.public import PrivateKey, SealedBox


def generate_hub_keys():
    sk = PrivateKey.generate()
    return bytes(sk), bytes(sk.public_key)


def seal(recipient_pubkey_bytes, plaintext: bytes) -> bytes:
    from nacl.public import PublicKey
    return SealedBox(PublicKey(recipient_pubkey_bytes)).encrypt(plaintext)


def unseal(hub_privkey_bytes, ciphertext: bytes) -> bytes:
    return SealedBox(PrivateKey(hub_privkey_bytes)).decrypt(ciphertext)
