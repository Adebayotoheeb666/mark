# Relay (Phase 7)
Opaque store-and-forward. **Phase 0: API contract only (see TECH_DESIGN §7).**

Endpoints: `POST /v1/envelopes`, `GET /v1/envelopes?for_hub=`, `POST /v1/envelopes/:id/ack`, `DELETE /v1/envelopes/:id`.
Invariants: ciphertext-only, 30d TTL / 7d grace, minimal logs, rate limits.
