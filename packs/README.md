# Packs (v0 — Phase 0)
Signed ZIP: `manifest.json + grading_scales.json + weights.json + templates/ + comments.csv + checks.yaml + locale.json`.

- Schemas: `../schemas/pack_manifest.json`
- Example: `manifest.example.json`, `grading_scales.example.json`, `weights.example.json`, `checks.example.yaml`
- Tooling: `../scripts/pack_sign_verify.py` (Ed25519 via PyNaCl; HMAC demo fallback if lib missing)

Term pins pack version; mid-term upgrade blocked without re-validation override.
