# Agent Mark — Technical Design (TECH_DESIGN)
**Status:** Draft v1.0 | **Depends on:** PRD v1.0, DECISIONS.md | **Gates:** Phase 0 → Phase 1

## 1. Architecture Overview

```
[Teacher App] --(a) LAN mDNS + TLS 1.3 (pinned)--> [Hub: API + Engine + DB]
[Teacher App] --(b) Sealed envelope (NaCl box)--> [Relay] <--poll-- [Hub]
[Hub] --ciphertext only--> [Backup targets: USB / 2nd PC / Vault]
```

- Hub is system of record. App and Relay never authoritative for grades.
- All compute + print works with Relay down. Relay outage only delays remote sync.
- No inbound ports required on school router. Hub polls Relay outbound HTTPS.

## 2. Repo Layout (monorepo)

```
/hub        Go backend + local web console (React, served from localhost)
/engine     Pure calc + validation modules (Go, zero deps) + golden vectors
/app        Flutter (Android first, iOS second)
/relay      Go API + S3-compatible blob store + TTL sweeper
/packs      Pack schemas, starter packs, sign/verify tooling
/e2e        Playwright + device-farm scripts, chaos scripts
/docs       This file, ADRs, specs, runbooks
```

CI: lint → unit → property → SAST → dep-scan → reproducible-build → sign staging.

## 3. Hub Backend

- **Runtime:** Single binary (Go 1.2x), auto-start on boot (Windows Service / systemd), localhost web UI + LAN API on configurable port (default 8741).
- **DB:** SQLite + SQLCipher (AES-256-GCM). WAL mode + checksums. Migrations versioned (`PRAGMA user_version`). Nightly `PRAGMA integrity_check`.
- **API style:** REST JSON on `/api/v1/*`, TLS 1.3 with hub self-signed cert pinned by App. Auth: session token (PIN+password) + per-device key for App calls.
- **Jobs:** recompute queue (incremental + full-term), PDF batch queue, backup scheduler, relay poller (exponential backoff 30s→15min + manual trigger).
- **Reference hw:** i3 / 4GB / 128GB. Perf budget: recompute 1000×10 <60s; PDF ≤5s/student.

## 4. Engine Module (pure, no I/O)

- Package `engine/calc`: `WeightedAvg(scores, weights)`, `MapGrade(avg, scale)`, `Rank(avgs, mode)`, `Round()`, all integer-tenths internally.
- Package `engine/validate`: each rule `func Check(ctx) []Flag` returning `{rule_id, severity, message, suggestion}`.
- Rule versions: `engine_semver + pack_id@pack_ver → result.rule_version`. `explain()` returns inputs + rule IDs.
- Golden vectors in `/engine/testdata/*.json`, property tests with `go-quick`-style fuzz (10k cases in CI).

## 5. Local Web Console

- React SPA served by Hub binary (no CDN at runtime). Routes: Dashboard, Students, Scores, Flags, Comments, Reports, Packs, Backup, Settings.
- Global term switcher + readiness checklist (blocking vs warning). Every number links to `explain()` drawer (UX-002).
- RBAC enforced server-side: Admin, Head, Teacher (scoped to assignments), Viewer.

## 6. Teacher App

- Flutter, SQLCipher store (SQLCipher + OS keystore), no plaintext PII at rest.
- Pairing: Hub shows QR (hub_pubkey + short code + LAN URL) → App scans on LAN → Head approves → per-device X25519 keypair, hub stores device_pubkey.
- Sync: outbox table (`op_id UUID, type, payload, attempts`). LAN POST direct; remote POST sealed via Relay. Server-wins conflicts with diff UI.
- Approvals require PIN/biometric unlock per action.

## 7. Relay API (opaque)

- `POST /v1/envelopes {for_hub, nonce, ciphertext_b64, ttl_days}` → `{id, expires_at}`
- `GET /v1/envelopes?for_hub=<id>` → list of `{id, created_at, expires_at, size, blob_url}` (blob = nonce+ciphertext only)
- `POST /v1/envelopes/:id/ack` → starts 7-day grace delete timer
- `DELETE /v1/envelopes/:id` (hub only, signed by hub key)
- Limits: ≤256KB/envelope, ≤500/day/school, rate-limit 429 + Retry-After. Sweeper deletes expired hourly.
- Logs: `{ts, for_hub_hash, size, action}` only. No payload inspection. See RELAY_SPEC in Impl Plan Phase 7.

## 8. Crypto Summary

- Hub identity: Ed25519 (signing reports/acks) + X25519 (sealed envelopes), generated on-site via OS CSPRNG. Privkeys in OS store (DPAPI/libsecret/Keychain) + encrypted export (recovery phrase, Head custody).
- Envelopes: `crypto_box (X25519 + XSalsa20-Poly1305)`, nonce random 24B per message, compressed (zstd) pre-encrypt.
- Reports: SHA-256 hash + Ed25519 detached signature + QR (`report_id|hash|sig|verify_url`).
- Updates/Packs: Ed25519 release key (offline root), minisign-compatible signatures, rollback on verify fail.

## 9. Reports Pipeline

- Templates: HTML + CSS print (A4), fields bound via `{{result.total}}`-style allowlist only. Renderer: headless Chromium (hub-bundled) → PDF.
- Flow: snapshot term → render draft (DRAFT watermark) → approvals → lock → sign → batch files `{Year}_{Term}_{Class}_{StudentID}.pdf`.
- Mutation guard: snapshot hash compared at lock time; mismatch aborts affected students.

## 10. Packs

- Signed ZIP: `manifest.json (id, ver, engine_min), grading_scales.json, weights.json, templates/*.html, comments/*.csv, checks/*.yaml, locale.json`.
- Install: verify sig → dry-run validate → atomic swap → pin term to version. Mid-term upgrade blocked without re-validation override (logged).

## 11. Backups & Updates

- Backup: zstd + age/XChaCha20-Poly1305 (school key) → USB / 2nd PC (LAN rsync-style) / Vault (Relay-adjacent opaque PUT). Manifest `{ts, counts, db_hash}` signed by hub.
- Updates: manifest poll (no PII) → download → verify → stage → reboot-service → health-check → rollback on fail.

## 12. Observability (no PII to cloud)

- Local logs + health endpoint (disk, queue depth, last backup/sync). Relay exposes aggregate counters only (envelopes in/out, bytes, per-day). No per-student telemetry.
- Support bundle: one-click export (redacted config + logs + hashes), teacher explicitly attaches; never auto-uploads.

## 13. Open Tech Risks

- mDNS blocked on some school Wi-Fi → fallback: QR shows hub IP + manual entry.
- Low-end phone perf → entry sheets virtualized, payload cap 256KB.
- Power cuts → WAL + idempotent ops + resume queues on boot.
*End — any change requires ADR in DECISIONS.md.*
