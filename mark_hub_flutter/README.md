# Agent Mark Hub — Flutter App (desktop first, mobile next)

## Status
Scaffold complete, uncompiled (Flutter SDK still downloading). Screens mirror the Tauri console spec 1:1.

## Layout (`lib/`)
- `main.dart` — Material3 shell, NavigationRail, 8 sections
- `screens.dart` — Dashboard, Students (+CSV import), Scores (+deterministic results), Flags (scan/triage), Comments (picker), Reports (draft→approve→lock), Backup (gate), Audit
- `engine.dart` — calc + validation port (same rules/thresholds as Python ref)
- `store.dart` — sqflite_common_ffi store: versioned scores, flag inbox, hash-chained audit, Ed25519 hub keys + backup key generated at first open

## Run it (once SDK lands)
1. Extract SDK, add `flutter\bin` to PATH, `flutter doctor`, `flutter pub get`.
2. Windows desktop needs **Visual Studio 2022 + C++ workload** (`flutter doctor` will say). Without it, use web instead:
3. `flutter run -d windows` (needs VS) or `flutter run -d chrome` / `flutter build web` (no VS needed).

## Known gaps before audit (do not skip)
- `screens.dart` report signing uses a dev placeholder hash + `sig:` tag; wire to the real Ed25519 key in `store.dart` (`cryptography` pkg already declared) before any pilot.
- Backup pane marks verified/drill flags without real encrypt→wipe→restore yet; `store.dart` holds the real backup key — implement SecretBox backup (mirrors `hub/backup.py`) before pilot PII.
- No lock-screen/PIN, no TLS-pinned LAN sync, no relay client yet (teacher mobile app = next workstream).
