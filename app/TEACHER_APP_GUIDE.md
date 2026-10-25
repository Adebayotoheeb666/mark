# Agent Mark — Teacher App Guide (reference protocol)
**Pair → Load sheet → Enter offline → Sync → Resolve conflicts.**

## Pairing
Hub shows 6-digit code (15-min TTL) → App submits → Head/Admin approves → per-device ID `paired`. Teacher-approved codes only; expired/invalid rejected. Lost phone: hub `revoke(device)` blocks next sync; replacement re-pairs fresh.

## Entry
Sheets mirror hub max/weights (`load_sheet` first). Instant local `VAL-RANGE/MISS` check — blocked entries never queue. Outbox: `{op_id, kind, payload}` ≤256KB, retried in order.

## Sync (LAN-first; relay fallback in Phase 7)
Push queued ops; hub applies via `store.add_score` (server-wins on VAL-DUP-01 → op marked `conflict` with hub diff). Idempotent `op_id` — retries never duplicate. Resolve: keep hub (sheet refreshes) or enter corrected value (new hub version, logged).

## Prod delta (Flutter build)
SQLCipher store, mDNS discovery + TLS pinning, biometric/PIN approval confirm, low-end keystroke <100ms, background retry. Protocol here is conformance reference.
