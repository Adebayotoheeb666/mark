# Phase 7 Report — Relay + E2E Encryption
**Date:** 2026-10-16 | **Strategy:** Plan → Build → Test → Document → Repeat | **Result:** GATE PASSED → proceed to Phase 8

## Plan (done)
Opaque store-forward, sealed-box E2E, 30d/7d TTL, metadata-only logs, rate caps, hub poll + idempotent apply, outage-safe local path.

## Build (done)
- `relay/crypto.py` — real SealedBox keygen/seal/unseal (PyNaCl installed this phase: pynacl-1.6.2)
- `relay/store.py` — `Relay` (post/list/fetch/ack/delete/sweep, 256KB + 500/day 429s) + `hub_poll` (decrypt-local, dedup, ack)
- `relay/RELAY_SPEC.md`

## Test (done — executed)
- `pytest relay app hub engine` → **41/41 passed** (6 relay + 35 regression)
- Round-trip + wrong-key fail; TTL defaults (30d) + grace shortening + sweep; opacity (names/IDs/subjects absent from metadata/logs; wrong-key unseal raises); 429 size + daily caps; remote-teacher post→poll applies once + duplicate deduped; outage raises yet local calc grade A unaffected

## Document (done)
Spec above (API, crypto, polling, parent wording).

## Repeat / Gate G7→G8
- [x] Opacity + TTL + outage-unaffected proofs pass
- Carry-forward: backoff poller + TLS transport + abuse monitoring in prod relay (Phase 8 hardening runs `pip freeze` to pin pynacl; engine/report hmac-demo fallbacks must switch to Ed25519 before audit).
