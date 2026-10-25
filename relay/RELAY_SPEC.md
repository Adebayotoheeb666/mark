# Agent Mark — Relay Spec (Post Office)
**Status:** Phase 7 built (real E2E) | **Crypto:** SealedBox (X25519 + XSalsa20-Poly1305, PyNaCl)

## API
`post(for_hub, blob)` → `{id, expires_at}` · `list_for_hub` (metadata only) · `fetch(id)` → ciphertext · `ack(id)` (starts 7-day grace) · `delete(id)` · `sweep()` (hourly).
Limits: 256KB/envelope, 500/day/school (429 + retry). Log: `{ts, hub_fp, size, action}` — never payload/keys/PII.

## Crypto
Hub keypair on-site (`generate_hub_keys`); phones seal to hub pubkey; hub unseals locally. Wrong-key decrypt raises. TTL: 30d unclaimed / 7d post-ACK (constants `UNCLAIMED_TTL`, `GRACE_TTL`).

## Hub polling
`hub_poll(hub_con, relay, privkey, hub_id, apply_fn)`: list → fetch → unseal → idempotent apply (`applied_ops`) → ack. Outage: raises `ConnectionError`; local compute/print never blocked (tested).

## Parent wording
"Sealed envelopes the service cannot open; auto-deleted (≈30 days unclaimed, days after delivery)."
