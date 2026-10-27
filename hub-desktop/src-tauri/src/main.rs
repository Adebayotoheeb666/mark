#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Agent Mark Hub — Tauri backend v0.2.0
// Local-first school records. The database is an in-memory SQLite image sealed with
// XChaCha20-Poly1305 at rest; each staff account unwraps the data key with Argon2id.
// No cloud, no AI, no caller-supplied actor.
mod store;
mod vault;

use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Manager, State};
use vault::{Vault, VaultUser};
use zeroize::Zeroizing;

const ENGINE_VERSION: &str = "0.3.0";
const PACK_ID: &str = "ng-secondary@1.4.0";
const TEMPLATE_VER: &str = "ng-secondary-rep@1.4.0";
const SCHEMA_VERSION: &str = "2";
const IDLE_SECS: u64 = 15 * 60;
const MOBILE_MAGIC: &[u8; 8] = b"AGMMOB01";
const MOBILE_AAD: &[u8] = b"AGM-MOBILE-TRANSFER-V1";
const MOBILE_ITER: u32 = 310_000;

struct Session {
    username: String,
    role: String,
    data_key: Zeroizing<Vec<u8>>,
    must_change: bool,
}

#[derive(Clone)]
struct Snapshot {
    username: String,
    role: String,
    data_key: Zeroizing<Vec<u8>>,
    must_change: bool,
}

struct AuthThrottle {
    failures: u32,
    until: Option<Instant>,
}

struct AppState {
    dir: PathBuf,
    vault: Mutex<Option<Vault>>,
    vault_error: Mutex<Option<String>>,
    session: Mutex<Option<Session>>,
    db: Mutex<Option<Connection>>,
    last_activity: Mutex<Instant>,
    auth: Mutex<AuthThrottle>,
}

// ---------- schema ----------
const SCHEMA: &str = "
PRAGMA journal_mode=MEMORY;
PRAGMA synchronous=OFF;
PRAGMA temp_store=MEMORY;
PRAGMA secure_delete=ON;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, short_code TEXT UNIQUE NOT NULL, first TEXT, last TEXT, class TEXT, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS assessments(subject TEXT, label TEXT, max_score REAL, weight REAL, PRIMARY KEY(subject, label));
CREATE TABLE IF NOT EXISTS scores(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, value REAL, entered_by TEXT, version INT, supersedes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS flags(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, rule_id TEXT, severity TEXT, message TEXT, status TEXT DEFAULT 'open', disposition TEXT, actor TEXT, note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS comments(student_code TEXT, subject TEXT, term TEXT, template_id TEXT, final_text TEXT, author TEXT, PRIMARY KEY(student_code, subject, term));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, student_code TEXT, term TEXT, version INT, payload TEXT, hash TEXT, signature TEXT, status TEXT, approvals TEXT);
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, action TEXT, entity TEXT, before_json TEXT, after_json TEXT, prev_hash TEXT, hash TEXT);
CREATE TABLE IF NOT EXISTS backups(id TEXT PRIMARY KEY, path TEXT, sha256 TEXT, bytes INTEGER, students INTEGER, scores INTEGER, reports INTEGER, audit_rows INTEGER, audit_head TEXT, digest TEXT, created_at TEXT, verified_at TEXT, manifest_sig TEXT);
";

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("t{s}")
}

fn now_secs() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn parse_iso_secs(s: &str) -> Option<u64> {
    s.strip_prefix('t')?.parse::<u64>().ok()
}

// ---------- audit + meta ----------
fn audit(db: &Connection, actor: &str, action: &str, entity: &str, before: &str, after: &str) {
    let prev: String = db
        .query_row("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
        .optional()
        .unwrap()
        .unwrap_or_else(|| "GENESIS".to_string());
    let body = format!("{actor}|{action}|{entity}|{before}|{after}|{prev}");
    let hash = hex::encode(Sha256::digest(body.as_bytes()));
    db.execute(
        "INSERT INTO audit(ts,actor,action,entity,before_json,after_json,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?)",
        params![now_iso(), actor, action, entity, before, after, prev, hash],
    )
    .unwrap();
}

fn meta_get(db: &Connection, k: &str) -> Option<String> {
    db.query_row("SELECT v FROM meta WHERE k=?", [k], |r| r.get(0))
        .optional()
        .unwrap()
}

fn meta_set(db: &Connection, k: &str, v: &str, actor: &str) {
    db.execute("INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)", params![k, v])
        .unwrap();
    audit(db, actor, &format!("flag.{k}"), k, "null", v);
}

fn verify_audit_chain(db: &Connection) -> Result<(), String> {
    let mut stmt = db
        .prepare("SELECT actor,action,entity,before_json,after_json,prev_hash,hash FROM audit ORDER BY seq")
        .map_err(|e| format!("audit read failed: {e}"))?;
    let mut rows = stmt.query([]).map_err(|e| format!("audit read failed: {e}"))?;
    let mut prev = "GENESIS".to_string();
    while let Some(r) = rows.next().map_err(|e| format!("audit read failed: {e}"))? {
        let actor: String = r.get(0).map_err(|e| e.to_string())?;
        let action: String = r.get(1).map_err(|e| e.to_string())?;
        let entity: String = r.get(2).map_err(|e| e.to_string())?;
        let before: String = r.get(3).map_err(|e| e.to_string())?;
        let after: String = r.get(4).map_err(|e| e.to_string())?;
        let prev_hash: String = r.get(5).map_err(|e| e.to_string())?;
        let hash: String = r.get(6).map_err(|e| e.to_string())?;
        if prev_hash != prev {
            return Err("audit chain is broken (previous hash mismatch).".into());
        }
        let body = format!("{actor}|{action}|{entity}|{before}|{after}|{prev}");
        let expect = hex::encode(Sha256::digest(body.as_bytes()));
        if hash != expect {
            return Err("audit chain is broken (row hash mismatch).".into());
        }
        prev = hash;
    }
    Ok(())
}

fn db_counts(db: &Connection) -> (i64, i64, i64, i64) {
    let students = db.query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0)).unwrap_or(0);
    let scores = db.query_row("SELECT COUNT(*) FROM scores", [], |r| r.get(0)).unwrap_or(0);
    let reports = db.query_row("SELECT COUNT(*) FROM reports", [], |r| r.get(0)).unwrap_or(0);
    let audit = db.query_row("SELECT COUNT(*) FROM audit", [], |r| r.get(0)).unwrap_or(0);
    (students, scores, reports, audit)
}

fn audit_head(db: &Connection) -> String {
    db.query_row("SELECT hash FROM audit ORDER BY seq DESC LIMIT 1", [], |r| r.get(0))
        .optional()
        .unwrap()
        .unwrap_or_else(|| "GENESIS".to_string())
}

fn db_digest(db: &Connection) -> Result<String, String> {
    let mut h = Sha256::new();
    for table in ["meta", "students", "assessments", "scores", "flags", "comments", "reports", "audit"] {
        h.update(table.as_bytes());
        h.update(b"\n");
        let sql = format!("SELECT * FROM {table} ORDER BY 1");
        let mut stmt = db.prepare(&sql).map_err(|e| format!("digest query failed: {e}"))?;
        let n = stmt.column_count();
        let mut rows = stmt.query([]).map_err(|e| format!("digest query failed: {e}"))?;
        while let Some(row) = rows.next().map_err(|e| format!("digest query failed: {e}"))? {
            for i in 0..n {
                let v: rusqlite::types::Value = row.get(i).map_err(|e| e.to_string())?;
                h.update(format!("{v:?}|").as_bytes());
            }
            h.update(b"\n");
        }
    }
    Ok(hex::encode(h.finalize()))
}

// ---------- deterministic engine ----------
fn round_half_up(x: f64) -> i64 {
    (x + 0.5).floor() as i64
}

fn weighted_avg_tenths(items: &[(f64, f64, f64)]) -> Result<i64, String> {
    if items.is_empty() {
        return Err("VAL-MISS-01: no assessments provided".into());
    }
    let mut wsum = 0.0;
    let mut acc = 0.0;
    for (v, m, w) in items {
        if *m <= 0.0 {
            return Err("VAL-TYPE-01: max_score must be > 0".into());
        }
        if *v < 0.0 || *v > *m {
            return Err(format!("VAL-RANGE-01: {v} is outside 0–{m}"));
        }
        wsum += w;
        acc += v / m * w * 10.0;
    }
    if (wsum - 100.0).abs() > 1e-9 {
        return Err(format!("VAL-WEIGHT-01: weights sum to {wsum}%, must be 100%"));
    }
    Ok(round_half_up(acc + 1e-9))
}

fn map_grade(avg_t: i64) -> &'static str {
    for (min, g) in [(70, "A"), (60, "B"), (50, "C"), (45, "D"), (40, "E")] {
        if avg_t >= min * 10 {
            return g;
        }
    }
    "F"
}

fn rule_version() -> String {
    format!("engine {ENGINE_VERSION} + {PACK_ID}")
}

// ---------- DTOs ----------
#[derive(Serialize)]
struct Dashboard {
    students: i64,
    scores: i64,
    flags_open: i64,
    reports_locked: i64,
    backup_verified: bool,
    drill_passed: bool,
    live: bool,
    data_mode: String,
    privacy_ack: bool,
    test_override: bool,
    test_override_available: bool,
    school_name: String,
    username: String,
    role: String,
    must_change: bool,
    last_backup_at: Option<String>,
    last_drill_at: Option<String>,
    blocking: Vec<String>,
    warning: Vec<String>,
}

#[derive(Serialize)]
struct Student {
    short_code: String,
    first: String,
    last: String,
    class: String,
}

#[derive(Serialize)]
struct ImportResult {
    errors: Vec<String>,
    would_import: i64,
    would_import_scores: i64,
}

#[derive(Serialize)]
struct SubjectResult {
    total: f64,
    avg: f64,
    grade: String,
}

#[derive(Serialize)]
struct StudentResult {
    code: String,
    name: String,
    class: String,
    subjects: std::collections::HashMap<String, SubjectResult>,
    overall: f64,
    position: i64,
}

#[derive(Serialize, Clone)]
struct Flag {
    id: String,
    student_code: String,
    subject: String,
    label: String,
    rule_id: String,
    severity: String,
    message: String,
    status: String,
}

#[derive(Serialize)]
struct Template {
    id: String,
    subject: String,
    band: String,
    text: String,
    max_chars: i64,
}

#[derive(Deserialize)]
struct Ctx {
    name: String,
    subject: String,
    score: String,
    strength: String,
    next_step: String,
}

#[derive(Serialize)]
struct Report {
    id: String,
    student_code: String,
    term: String,
    version: i64,
    status: String,
    approvals: String,
    hash: String,
    signature: String,
}

#[derive(Serialize)]
struct AuditRow {
    seq: i64,
    actor: String,
    action: String,
    entity: String,
}

#[derive(Serialize)]
struct VaultStatus {
    initialized: bool,
    unlocked: bool,
    username: Option<String>,
    role: Option<String>,
    must_change: bool,
}

#[derive(Serialize)]
struct SetupResult {
    username: String,
    role: String,
    recovery_code: String,
}

#[derive(Serialize)]
struct UnlockResult {
    username: String,
    role: String,
    must_change: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct BackupManifest {
    version: u32,
    backup_id: String,
    created_at: String,
    bytes: usize,
    sha256: String,
    students: i64,
    scores: i64,
    reports: i64,
    audit_rows: i64,
    audit_head: String,
    digest: String,
    schema_version: String,
    school_name: String,
    hub_pubkey: String,
    sig: String,
}

// ---------- auth/session helpers ----------
fn ensure_vault_loaded(state: &AppState) -> Result<(), String> {
    if let Some(e) = state
        .vault_error
        .lock()
        .map_err(|_| "Vault state unavailable.")?
        .as_ref()
    {
        return Err(e.clone());
    }
    let mut v = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    if v.is_none() {
        if let Some(loaded) = Vault::load(&vault::vault_path(&state.dir))? {
            *v = Some(loaded);
        }
    }
    Ok(())
}

fn lock_now(state: &AppState) {
    if let Ok(mut db) = state.db.lock() {
        *db = None;
    }
    if let Ok(mut s) = state.session.lock() {
        *s = None;
    }
}

fn auth_lockout_secs(state: &AppState) -> Option<u64> {
    let mut a = state.auth.lock().ok()?;
    if let Some(until) = a.until {
        let now = Instant::now();
        if now < until {
            return Some((until - now).as_secs().max(1));
        }
        a.until = None;
        a.failures = 0;
    }
    None
}

fn record_auth_failure(state: &AppState) {
    if let Ok(mut a) = state.auth.lock() {
        a.failures = a.failures.saturating_add(1);
        if a.failures >= 5 {
            let step = (a.failures - 5).min(5);
            let secs = (30u64 << step).min(15 * 60);
            a.until = Some(Instant::now() + Duration::from_secs(secs));
        }
    }
}

fn clear_auth_failures(state: &AppState) {
    if let Ok(mut a) = state.auth.lock() {
        a.failures = 0;
        a.until = None;
    }
}

fn session_snapshot(state: &AppState) -> Result<Snapshot, String> {
    {
        let mut last = state
            .last_activity
            .lock()
            .map_err(|_| "Session state unavailable.")?;
        if last.elapsed() > Duration::from_secs(IDLE_SECS) {
            drop(last);
            lock_now(state);
            return Err("Session locked after inactivity. Sign in again.".into());
        }
        *last = Instant::now();
    }
    let s = state.session.lock().map_err(|_| "Session state unavailable.")?;
    let s = s.as_ref().ok_or("Sign in required.")?;
    Ok(Snapshot {
        username: s.username.clone(),
        role: s.role.clone(),
        data_key: s.data_key.clone(),
        must_change: s.must_change,
    })
}

fn require_active(s: &Snapshot) -> Result<(), String> {
    if s.must_change {
        return Err("Change your temporary password before continuing.".into());
    }
    Ok(())
}

fn require_role(s: &Snapshot, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&s.role.as_str()) {
        Ok(())
    } else {
        Err(format!(
            "This action requires role {} (you are {}).",
            allowed.join(" or "),
            s.role
        ))
    }
}

fn persist_state(state: &AppState, db: &Connection) -> Result<(), String> {
    let key = {
        let s = state.session.lock().map_err(|_| "Session state unavailable.")?;
        s.as_ref()
            .ok_or("Sign in required.")?
            .data_key
            .clone()
    };
    store::persist(&state.dir, db, &key)
}

fn db_guard<'a>(
    state: &'a AppState,
) -> Result<std::sync::MutexGuard<'a, Option<Connection>>, String> {
    state.db.lock().map_err(|_| "Database state unavailable.".to_string())
}

// ---------- setup / unlock ----------
#[tauri::command]
fn vault_status(state: State<AppState>) -> Result<VaultStatus, String> {
    ensure_vault_loaded(&state)?;
    let initialized = state
        .vault
        .lock()
        .map_err(|_| "Vault state unavailable.")?
        .is_some();
    let s = state.session.lock().map_err(|_| "Session state unavailable.")?;
    let (unlocked, username, role, must_change) = match s.as_ref() {
        Some(s) => (
            true,
            Some(s.username.clone()),
            Some(s.role.clone()),
            s.must_change,
        ),
        None => (false, None, None, false),
    };
    Ok(VaultStatus {
        initialized,
        unlocked,
        username,
        role,
        must_change,
    })
}

#[tauri::command]
fn setup(
    state: State<AppState>,
    school_name: String,
    username: String,
    password: String,
    confirm: String,
) -> Result<SetupResult, String> {
    let school_name = school_name.trim().to_string();
    if school_name.is_empty() || school_name.chars().count() > 80 {
        return Err("School name must be 1–80 characters.".into());
    }
    if password != confirm {
        return Err("Passwords do not match.".into());
    }
    let username = vault::normalize_username(&username);
    vault::validate_username(&username)?;
    vault::validate_password(&password, &username)?;

    if let Some(e) = state
        .vault_error
        .lock()
        .map_err(|_| "Vault state unavailable.")?
        .as_ref()
    {
        return Err(format!(
            "Vault is unreadable: {e} Restore vault.json from the backup kit."
        ));
    }
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    if vg.is_some() || vault::vault_path(&state.dir).exists() {
        return Err("This hub is already initialized. Sign in instead.".into());
    }

    let data_key = vault::new_data_key();
    let recovery_code = vault::generate_recovery_code();
    let recovery = vault::wrap_key(
        &vault::normalize_recovery(&recovery_code),
        &data_key,
        vault::recovery_aad(),
    )?;
    let mut v = Vault::new(recovery);
    v.add_user(&username, "admin", &password, &data_key, false)?;
    v.save(&vault::vault_path(&state.dir))?;

    let db_existed = store::db_path(&state.dir).exists();
    let setup_db = (|| -> Result<Connection, String> {
        let db = if db_existed {
            store::migrate_legacy(&state.dir, &data_key, SCHEMA)
        } else {
            store::open_encrypted(&state.dir, &data_key, SCHEMA)
        }?;
        db.execute_batch(SCHEMA)
            .map_err(|e| format!("Cannot initialize schema: {e}"))?;
        meta_set(&db, "schema_version", SCHEMA_VERSION, &username);
        meta_set(&db, "school_name", &school_name, &username);
        meta_set(&db, "data_mode", "demo", &username);
        meta_set(&db, "demo_cleared", "no", &username);
        meta_set(&db, "privacy_ack", "no", &username);
        meta_set(&db, "backup_verified", "no", &username);
        meta_set(&db, "drill_passed", "no", &username);
        store::persist(&state.dir, &db, &data_key)?;
        Ok(db)
    })();
    let db = match setup_db {
        Ok(db) => db,
        Err(e) => {
            let _ = std::fs::remove_file(vault::vault_path(&state.dir));
            if !db_existed {
                let path = store::db_path(&state.dir);
                let mut tmp = path.as_os_str().to_os_string();
                tmp.push(".tmp");
                let mut bak = path.as_os_str().to_os_string();
                bak.push(".bak");
                let _ = std::fs::remove_file(&path);
                let _ = std::fs::remove_file(PathBuf::from(tmp));
                let _ = std::fs::remove_file(PathBuf::from(bak));
            }
            return Err(e);
        }
    };

    *vg = Some(v);
    drop(vg);
    *state.db.lock().map_err(|_| "Database state unavailable.")? = Some(db);
    *state.session.lock().map_err(|_| "Session state unavailable.")? = Some(Session {
        username: username.clone(),
        role: "admin".into(),
        data_key,
        must_change: false,
    });
    *state.last_activity.lock().map_err(|_| "Session state unavailable.")? = Instant::now();
    if let Ok(mut e) = state.vault_error.lock() {
        *e = None;
    }
    clear_auth_failures(&state);

    Ok(SetupResult {
        username,
        role: "admin".into(),
        recovery_code,
    })
}

#[tauri::command]
fn unlock(state: State<AppState>, username: String, password: String) -> Result<UnlockResult, String> {
    if let Some(secs) = auth_lockout_secs(&state) {
        return Err(format!(
            "Too many failed attempts. Try again in {secs} seconds."
        ));
    }
    ensure_vault_loaded(&state)?;
    let vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_ref().ok_or("This hub is not initialized.")?;
    let u: &VaultUser = match v.find(&username) {
        Some(u) => u,
        None => {
            drop(vg);
            record_auth_failure(&state);
            return Err("Invalid username or password.".into());
        }
    };
    let aad = format!("AGM-VAULT-USER-V1|{}", u.username);
    let data_key = match vault::unwrap_key(&password, &u.wrapped, aad.as_bytes()) {
        Ok(k) => k,
        Err(_) => {
            drop(vg);
            record_auth_failure(&state);
            return Err("Invalid username or password.".into());
        }
    };
    let role = u.role.clone();
    let must_change = u.must_change;
    let canonical_username = u.username.clone();
    drop(vg);
    clear_auth_failures(&state);

    let db = store::open_existing(&state.dir, &data_key)?;
    db.execute_batch(SCHEMA)
        .map_err(|e| format!("Cannot update schema: {e}"))?;
    db.execute(
        "INSERT OR IGNORE INTO meta(k,v) VALUES('schema_version',?)",
        [SCHEMA_VERSION],
    )
    .map_err(|e| format!("Cannot update schema version: {e}"))?;

    *state.db.lock().map_err(|_| "Database state unavailable.")? = Some(db);
    *state.session.lock().map_err(|_| "Session state unavailable.")? = Some(Session {
        username: canonical_username.clone(),
        role: role.clone(),
        data_key,
        must_change,
    });
    *state.last_activity.lock().map_err(|_| "Session state unavailable.")? = Instant::now();
    Ok(UnlockResult {
        username: canonical_username,
        role,
        must_change,
    })
}

#[tauri::command]
fn lock(state: State<AppState>) -> Result<String, String> {
    {
        let guard = db_guard(&state)?;
        if let Some(db) = guard.as_ref() {
            let _ = persist_state(&state, db);
        }
    }
    lock_now(&state);
    Ok("Locked.".into())
}

#[tauri::command]
fn change_password(
    state: State<AppState>,
    old_password: String,
    new_password: String,
    confirm: String,
) -> Result<String, String> {
    if new_password != confirm {
        return Err("New passwords do not match.".into());
    }
    let s = session_snapshot(&state)?;
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_mut().ok_or("This hub is not initialized.")?;
    let idx = v
        .users
        .iter()
        .position(|u| u.username == s.username)
        .ok_or("Unknown user.")?;
    let aad = format!("AGM-VAULT-USER-V1|{}", s.username);
    let check = vault::unwrap_key(&old_password, &v.users[idx].wrapped, aad.as_bytes())?;
    if check.as_slice() != s.data_key.as_slice() {
        return Err("Old password is incorrect.".into());
    }
    vault::validate_password(&new_password, &s.username)?;
    let wrapped = vault::wrap_key(&new_password, &s.data_key, aad.as_bytes())?;
    v.users[idx].wrapped = wrapped;
    v.users[idx].must_change = false;
    v.save(&vault::vault_path(&state.dir))?;
    drop(vg);

    {
        let guard = db_guard(&state)?;
        let db = guard.as_ref().ok_or("Sign in required.")?;
        audit(db, &s.username, "auth.password_change", &s.username, "changed", "ok");
        persist_state(&state, db)?;
    }
    if let Ok(mut session) = state.session.lock() {
        if let Some(sess) = session.as_mut() {
            sess.must_change = false;
        }
    }
    Ok("Password changed.".into())
}

#[tauri::command]
fn recovery_reset(
    state: State<AppState>,
    username: String,
    recovery_code: String,
    new_password: String,
    confirm: String,
) -> Result<String, String> {
    if new_password != confirm {
        return Err("New passwords do not match.".into());
    }
    ensure_vault_loaded(&state)?;
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_mut().ok_or("This hub is not initialized.")?;
    let data_key = vault::unwrap_key(
        &vault::normalize_recovery(&recovery_code),
        &v.recovery,
        vault::recovery_aad(),
    )
    .map_err(|_| "Invalid recovery code.".to_string())?;
    v.reset_password(&username, &new_password, &data_key, true)?;
    v.save(&vault::vault_path(&state.dir))?;
    clear_auth_failures(&state);
    Ok("Password reset. Sign in with the new password.".into())
}

#[tauri::command]
fn users_list(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_ref().ok_or("This hub is not initialized.")?;
    Ok(v.public_users())
}

#[tauri::command]
fn user_add(
    state: State<AppState>,
    username: String,
    role: String,
    temp_password: String,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_mut().ok_or("This hub is not initialized.")?;
    v.add_user(&username, &role, &temp_password, &s.data_key, true)?;
    v.save(&vault::vault_path(&state.dir))?;
    drop(vg);
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    audit(db, &s.username, "auth.user_add", &vault::normalize_username(&username), "null", &role);
    persist_state(&state, db)?;
    Ok("User added. They must change the temporary password at first sign-in.".into())
}

#[tauri::command]
fn user_reset_password(
    state: State<AppState>,
    username: String,
    new_password: String,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let target = vault::normalize_username(&username);
    if target == s.username {
        return Err("Use Change password for your own account.".into());
    }
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_mut().ok_or("This hub is not initialized.")?;
    v.reset_password(&target, &new_password, &s.data_key, true)?;
    v.save(&vault::vault_path(&state.dir))?;
    drop(vg);
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    audit(db, &s.username, "auth.user_reset", &target, "reset", "must_change");
    persist_state(&state, db)?;
    Ok("Password reset. The user must change it at next sign-in.".into())
}

#[tauri::command]
fn user_remove(state: State<AppState>, username: String) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let target = vault::normalize_username(&username);
    if target == s.username {
        return Err("You cannot remove your own account.".into());
    }
    let mut vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_mut().ok_or("This hub is not initialized.")?;
    v.remove_user(&target)?;
    v.save(&vault::vault_path(&state.dir))?;
    drop(vg);
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    audit(db, &s.username, "auth.user_remove", &target, "active", "removed");
    persist_state(&state, db)?;
    Ok("User removed.".into())
}

// ---------- dashboard / roster ----------
#[tauri::command]
fn dashboard(state: State<AppState>) -> Result<Dashboard, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let students: i64 = db.query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0)).unwrap();
    let scores: i64 = db.query_row("SELECT COUNT(*) FROM scores", [], |r| r.get(0)).unwrap();
    let flags_open: i64 = db
        .query_row("SELECT COUNT(*) FROM flags WHERE status='open'", [], |r| r.get(0))
        .unwrap();
    let reports_locked: i64 = db
        .query_row("SELECT COUNT(*) FROM reports WHERE status='locked'", [], |r| r.get(0))
        .unwrap();
    let data_mode = meta_get(db, "data_mode").unwrap_or_else(|| "demo".into());
    let privacy_ack = meta_get(db, "privacy_ack").as_deref() == Some("yes");
    let bv = meta_get(db, "backup_verified").as_deref() == Some("yes");
    let dp = meta_get(db, "drill_passed").as_deref() == Some("yes");
    let test_override = meta_get(db, "test_override").as_deref() == Some("yes");
    let test_override_available = real_data_test_override_available();
    let school_name = meta_get(db, "school_name").unwrap_or_else(|| "School".into());
    let last_backup_at = meta_get(db, "last_backup_at");
    let last_drill_at = meta_get(db, "last_drill_at");

    let mut blocking = vec![];
    let mut warning = vec![];
    if data_mode != "real" {
        blocking.push("DEMO MODE - real student data is blocked. Complete the gate, then enable real data.".into());
        if students > 0 {
            blocking.push("Demo students are present. Clear demo data before enabling real mode.".into());
        }
    }
    if students == 0 {
        blocking.push("No students imported.".into());
    }
    let n_ass: i64 = db.query_row("SELECT COUNT(*) FROM assessments", [], |r| r.get(0)).unwrap();
    if n_ass == 0 {
        blocking.push("No assessments configured.".into());
    }
    let mut stmt = db.prepare("SELECT subject, SUM(weight) FROM assessments GROUP BY subject").unwrap();
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?))).unwrap();
    for r in rows.flatten() {
        if (r.1 - 100.0).abs() > 1e-9 {
            blocking.push(format!("Weights for {} sum to {}%, must be 100%.", r.0, r.1));
        }
    }
    if !bv {
        blocking.push("No verified backup. Run a backup first.".into());
    }
    if !dp {
        blocking.push("Restore drill not passed. Run the drill.".into());
    }
    if !privacy_ack {
        blocking.push("Privacy notice not acknowledged by the admin.".into());
    }
    if test_override {
        warning.push("TEST MODE: the production real-data gate was bypassed. Use only synthetic or explicitly authorized test data; this is not a production approval.".into());
    }
    if students > 0 && scores == 0 {
        warning.push("No scores entered yet.".into());
    }
    if let Some(ts) = last_backup_at.as_deref().and_then(parse_iso_secs) {
        if now_secs().saturating_sub(ts) > 7 * 24 * 60 * 60 {
            warning.push("Last backup is older than 7 days.".into());
        }
    }
    Ok(Dashboard {
        students,
        scores,
        flags_open,
        reports_locked,
        backup_verified: bv,
        drill_passed: dp,
        live: data_mode == "real",
        data_mode,
        privacy_ack,
        test_override,
        test_override_available,
        school_name,
        username: s.username,
        role: s.role,
        must_change: s.must_change,
        last_backup_at,
        last_drill_at,
        blocking,
        warning,
    })
}

fn seed_demo_impl(db: &Connection, actor: &str) -> Result<String, String> {
    if meta_get(db, "data_mode").as_deref() == Some("real") {
        return Err("Cannot load demo data in real-data mode.".into());
    }
    db.execute("DELETE FROM scores", []).unwrap();
    db.execute("DELETE FROM students", []).unwrap();
    db.execute("DELETE FROM flags", []).unwrap();
    db.execute("DELETE FROM reports", []).unwrap();
    db.execute("DELETE FROM comments", []).unwrap();
    for (subj, label, max, w) in [
        ("MATHS", "CA1", 20.0, 20.0),
        ("MATHS", "CA2", 20.0, 20.0),
        ("MATHS", "Exam", 60.0, 60.0),
        ("ENG", "CA", 40.0, 40.0),
        ("ENG", "Exam", 60.0, 60.0),
    ] {
        db.execute(
            "INSERT OR REPLACE INTO assessments(subject,label,max_score,weight) VALUES(?,?,?,?)",
            params![subj, label, max, w],
        )
        .unwrap();
    }
    let names = [
        ("Ada", "Okafor"),
        ("Bola", "Bello"),
        ("Chidi", "Eze"),
        ("Dola", "Adeyemi"),
        ("Emeka", "Nwosu"),
        ("Funmi", "Lawal"),
    ];
    for (i, (first, last)) in names.iter().enumerate() {
        let sc = format!("26-JSS2A-{:03}", i + 1);
        db.execute(
            "INSERT OR REPLACE INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
            params![sc.clone(), sc, first, last, "JSS2-A"],
        )
        .unwrap();
    }
    meta_set(db, "school_name", "Greenfield Secondary School", actor);
    meta_set(db, "data_mode", "demo", actor);
    meta_set(db, "demo_cleared", "no", actor);
    meta_set(db, "backup_verified", "no", actor);
    meta_set(db, "drill_passed", "no", actor);
    meta_set(db, "privacy_ack", "no", actor);
    audit(db, actor, "seed.demo", "school", "null", "6 students");
    Ok("Demo school loaded: 6 students, MATHS + ENG assessments.".into())
}

#[tauri::command]
fn seed_demo(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let r = seed_demo_impl(db, &s.username)?;
    persist_state(&state, db)?;
    Ok(r)
}

#[tauri::command]
fn students(state: State<AppState>) -> Result<Vec<Student>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db.prepare("SELECT short_code, first, last, class FROM students ORDER BY short_code").unwrap();
    Ok(stmt
        .query_map([], |r| {
            Ok(Student {
                short_code: r.get(0)?,
                first: r.get(1)?,
                last: r.get(2)?,
                class: r.get(3)?,
            })
        })
        .unwrap()
        .flatten()
        .collect())
}

#[tauri::command]
fn roster_import(
    state: State<AppState>,
    csv_text: String,
    dry_run: bool,
) -> Result<ImportResult, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    if !dry_run {
        require_role(&s, &["admin"])?;
        let guard = db_guard(&state)?;
        let db = guard.as_ref().ok_or("Sign in required.")?;
        if meta_get(db, "data_mode").as_deref() != Some("real") {
            return Err("Real-data mode is locked. Complete setup, backup, drill and privacy acknowledgment, then enable real data.".into());
        }
    }
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut errors = vec![];
    let mut rows: Vec<(String, String, String, String)> = vec![];
    for (i, line) in csv_text.lines().enumerate() {
        if i == 0 || line.trim().is_empty() {
            continue;
        }
        let c: Vec<&str> = line.split(',').collect();
        if c.len() < 4 || c[0].trim().is_empty() || c[1].trim().is_empty() || c[3].trim().is_empty() {
            errors.push(format!("row {}: missing short_code/first_name/class_label", i + 1));
            continue;
        }
        let sc = c[0].trim().to_string();
        if rows.iter().any(|r: &(String, String, String, String)| r.0 == sc) {
            errors.push(format!("row {}: duplicate short_code {sc} in file", i + 1));
            continue;
        }
        let exists: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM students WHERE short_code=?)",
                [&sc],
                |r| r.get(0),
            )
            .unwrap();
        if exists {
            errors.push(format!("row {}: duplicate short_code {sc} in db", i + 1));
            continue;
        }
        rows.push((
            sc,
            c[1].trim().into(),
            c[2].trim().into(),
            c[3].trim().into(),
        ));
    }
    let n = rows.len() as i64;
    if !dry_run && errors.is_empty() {
        for (sc, f, l, cl) in rows {
            db.execute(
                "INSERT INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
                params![sc.clone(), sc, f, l, cl],
            )
            .unwrap();
        }
        audit(db, &s.username, "roster.import", "students", "null", &format!("{n} rows"));
        persist_state(&state, db)?;
    }
    Ok(ImportResult {
        errors,
        would_import: n,
        would_import_scores: 0,
    })
}

fn decrypt_mobile_export(file: &[u8], passphrase: &str) -> Result<serde_json::Value, String> {
    if file.len() < 8 + 16 + 12 + 16 {
        return Err("That file is too short to be an Agent Mark mobile export.".into());
    }
    if &file[..8] != MOBILE_MAGIC {
        return Err("That file is not an Agent Mark mobile export.".into());
    }
    let salt = &file[8..24];
    let iv = &file[24..36];
    let ct = &file[36..];
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, MOBILE_ITER, &mut key);
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|_| "Mobile key setup failed.")?;
    let plain = cipher
        .decrypt(
            Nonce::from_slice(iv),
            Payload {
                msg: ct,
                aad: MOBILE_AAD,
            },
        )
        .map_err(|_| "Wrong transfer passphrase or damaged mobile export.".to_string())?;
    serde_json::from_slice(&plain).map_err(|_| "The mobile export is not valid JSON.".to_string())
}

/// Import an encrypted `.agmm` transfer file produced by the mobile companion.
/// The file is encrypted with a transfer passphrase (PBKDF2-SHA-256 + AES-256-GCM),
/// separate from the phone passcode. Dry-run validates without writing.
#[tauri::command]
fn mobile_import(
    state: State<AppState>,
    file_b64: String,
    passphrase: String,
    dry_run: bool,
) -> Result<ImportResult, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    if passphrase.chars().count() < 12 {
        return Err("The transfer passphrase must be at least 12 characters.".into());
    }
    if !dry_run {
        require_role(&s, &["admin"])?;
        let guard = db_guard(&state)?;
        let db = guard.as_ref().ok_or("Sign in required.")?;
        if meta_get(db, "data_mode").as_deref() != Some("real") {
            return Err("Real-data mode is locked. Complete the backup gate, then enable real data before importing a real roster.".into());
        }
    }
    let raw = B64
        .decode(file_b64.trim())
        .map_err(|_| "The mobile file is not valid base64.")?;
    let v = decrypt_mobile_export(&raw, &passphrase)?;
    if v.get("version").and_then(|x| x.as_u64()) != Some(2) {
        return Err("Unsupported mobile export version.".into());
    }
    let students = v
        .get("students")
        .and_then(|x| x.as_array())
        .ok_or("The mobile export has no student list.")?;
    let scores = v
        .get("scores")
        .and_then(|x| x.as_object())
        .ok_or("The mobile export has no scores.")?;

    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut errors: Vec<String> = vec![];
    let mut new_students: Vec<(String, String, String, String)> = vec![];
    let mut seen_codes = std::collections::HashSet::new();

    for (i, st) in students.iter().enumerate() {
        let code = st.get("code").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        let name = st.get("name").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        let cls = st.get("cls").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
        if code.is_empty() || name.is_empty() || cls.is_empty() {
            errors.push(format!("student {}: missing code/name/class", i + 1));
            continue;
        }
        if !seen_codes.insert(code.clone()) {
            errors.push(format!("student {}: duplicate code {code}", i + 1));
            continue;
        }
        let (first, last) = match name.rsplit_once(' ') {
            Some((f, l)) => (f.to_string(), l.to_string()),
            None => (name.clone(), String::new()),
        };
        let existing: Option<(String, String, String)> = db
            .query_row(
                "SELECT first,last,class FROM students WHERE short_code=?",
                [&code],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()
            .unwrap_or(None);
        if let Some((ef, el, ec)) = existing {
            if ef != first || el != last || ec != cls {
                errors.push(format!("student {code}: already exists with different details"));
            }
            continue;
        }
        new_students.push((code, first, last, cls));
    }

    let mut new_scores: Vec<(String, String, String, f64)> = vec![];
    for (key, rec) in scores {
        let parts: Vec<&str> = key.splitn(3, '|').collect();
        if parts.len() != 3 {
            errors.push(format!("score {key}: expected code|subject|label"));
            continue;
        }
        let (code, subject, label) = (parts[0], parts[1], parts[2]);
        let value = match rec.get("v").and_then(|x| x.as_f64()) {
            Some(v) => v,
            None => {
                errors.push(format!("score {key}: missing numeric value"));
                continue;
            }
        };
        let max: Option<f64> = db
            .query_row(
                "SELECT max_score FROM assessments WHERE subject=? AND label=?",
                params![subject, label],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        let max = match max {
            Some(m) => m,
            None => {
                errors.push(format!("score {key}: unknown assessment {subject}/{label}"));
                continue;
            }
        };
        if value < 0.0 || value > max {
            errors.push(format!("score {key}: {value} is outside 0-{max}"));
            continue;
        }
        let in_db: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM students WHERE short_code=?)",
                [code],
                |r| r.get(0),
            )
            .unwrap_or(false);
        let in_file = new_students.iter().any(|(c, _, _, _)| c == code);
        if !in_db && !in_file {
            errors.push(format!("score {key}: student {code} is not in the roster"));
            continue;
        }
        let prior: Option<f64> = db
            .query_row(
                "SELECT value FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
                params![code, subject, label],
                |r| r.get(0),
            )
            .optional()
            .unwrap_or(None);
        if let Some(old) = prior {
            if (old - value).abs() > 1e-9 {
                errors.push(format!("score {key}: desktop already has {old}"));
            }
            continue;
        }
        new_scores.push((code.to_string(), subject.to_string(), label.to_string(), value));
    }

    if !dry_run && errors.is_empty() {
        if !new_students.is_empty() || !new_scores.is_empty() {
            db.execute_batch("BEGIN IMMEDIATE")
                .map_err(|e| format!("Cannot start import: {e}"))?;
            let write = (|| -> Result<(), String> {
                for (code, first, last, cls) in &new_students {
                    db.execute(
                        "INSERT INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
                        params![code, code, first, last, cls],
                    )
                    .map_err(|e| format!("Cannot insert student {code}: {e}"))?;
                }
                for (code, subject, label, value) in &new_scores {
                    let id = format!("m{}{}", now_iso().trim_start_matches('t'), rand::random::<u32>());
                    db.execute(
                        "INSERT INTO scores(id,student_code,subject,label,value,entered_by,version,supersedes,created_at) VALUES(?,?,?,?,?,?,1,NULL,?)",
                        params![id, code, subject, label, value, s.username, now_iso()],
                    )
                    .map_err(|e| format!("Cannot insert score {code} {subject}/{label}: {e}"))?;
                }
                Ok(())
            })();
            if let Err(e) = write {
                let _ = db.execute_batch("ROLLBACK");
                return Err(e);
            }
            db.execute_batch("COMMIT")
                .map_err(|e| format!("Cannot commit import: {e}"))?;
            audit(
                db,
                &s.username,
                "mobile.import",
                "students",
                "null",
                &format!("{} students, {} scores", new_students.len(), new_scores.len()),
            );
            persist_state(&state, db)?;
        }
    }

    Ok(ImportResult {
        errors,
        would_import: new_students.len() as i64,
        would_import_scores: new_scores.len() as i64,
    })
}

// ---------- scores / flags / comments ----------
#[tauri::command]
fn score_add(
    state: State<AppState>,
    student: String,
    subject: String,
    label: String,
    value: f64,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin", "teacher"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let max: f64 = db
        .query_row(
            "SELECT max_score FROM assessments WHERE subject=? AND label=?",
            params![subject, label],
            |r| r.get(0),
        )
        .optional()
        .unwrap()
        .ok_or_else(|| format!("unknown assessment {subject}/{label}"))?;
    if value.is_nan() {
        return Err("VAL-MISS-01: score is missing".into());
    }
    if value < 0.0 || value > max {
        return Err(format!("VAL-RANGE-01: {value} is outside 0–{max}"));
    }
    let mut stmt = db
        .prepare("SELECT id, value FROM scores WHERE student_code=? AND subject=? AND label=?")
        .unwrap();
    let priors: Vec<(String, f64)> = stmt
        .query_map(params![student, subject, label], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .flatten()
        .collect();
    if priors.iter().any(|(_, v)| (*v - value).abs() > 1e-9) {
        return Err("VAL-DUP-01: conflicting prior entry exists — use update flow".into());
    }
    if let Some((id, _)) = priors.first() {
        return Ok(id.clone());
    }
    let id = format!("s{}", now_iso().replace('t', "") + &rand::random::<u32>().to_string());
    db.execute(
        "INSERT INTO scores(id,student_code,subject,label,value,entered_by,version,supersedes,created_at) VALUES(?,?,?,?,?,?,1,NULL,?)",
        params![id, student, subject, label, value, s.username, now_iso()],
    )
    .unwrap();
    audit(
        db,
        &s.username,
        "score.add",
        &id,
        "null",
        &format!("{student} {subject}/{label}={value}"),
    );
    persist_state(&state, db)?;
    Ok(id)
}

#[tauri::command]
fn results(state: State<AppState>) -> Result<Vec<StudentResult>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db.prepare("SELECT short_code, first, class FROM students ORDER BY short_code").unwrap();
    let stus: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .flatten()
        .collect();
    let mut stmt2 = db.prepare("SELECT subject, label, max_score, weight FROM assessments").unwrap();
    let ass: Vec<(String, String, f64, f64)> = stmt2
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .flatten()
        .collect();
    let mut out = vec![];
    for (sc, first, class) in stus {
        let mut subjects = std::collections::HashMap::new();
        let mut sum = 0.0;
        let mut n = 0;
        for subj in ["MATHS", "ENG"] {
            let parts: Vec<(f64, f64, f64)> = ass
                .iter()
                .filter(|(s, _, _, _)| s == subj)
                .map(|(_, label, max, w)| {
                    let v: Option<f64> = db
                        .query_row(
                            "SELECT value FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
                            params![sc, subj, label],
                            |r| r.get(0),
                        )
                        .optional()
                        .unwrap();
                    Ok((v, *max, *w)) as Result<(Option<f64>, f64, f64), String>
                })
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter_map(|(v, m, w)| v.map(|x| (x, m, w)))
                .collect();
            if parts.is_empty() {
                continue;
            }
            let total: f64 = parts.iter().map(|(v, _, _)| v).sum();
            let avg_t = weighted_avg_tenths(&parts)?;
            let avg = avg_t as f64 / 10.0;
            subjects.insert(
                subj.to_string(),
                SubjectResult {
                    total,
                    avg,
                    grade: map_grade(avg_t).into(),
                },
            );
            sum += avg;
            n += 1;
        }
        out.push(StudentResult {
            code: sc.clone(),
            name: first,
            class,
            subjects,
            overall: if n > 0 { sum / n as f64 } else { 0.0 },
            position: 0,
        });
    }
    let mut idx: Vec<usize> = (0..out.len()).collect();
    idx.sort_by(|&a, &b| out[b].overall.partial_cmp(&out[a].overall).unwrap());
    let mut rank = 0;
    let mut prev = f64::NAN;
    for (pos, &i) in idx.iter().enumerate() {
        if out[i].overall != prev {
            rank = pos as i64 + 1;
            prev = out[i].overall;
        }
        out[i].position = rank;
    }
    Ok(out)
}

#[tauri::command]
fn flags_scan(state: State<AppState>) -> Result<Vec<Flag>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db.prepare("SELECT short_code FROM students").unwrap();
    let stus: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().flatten().collect();
    let mut stmt2 = db.prepare("SELECT subject, label FROM assessments").unwrap();
    let ass: Vec<(String, String)> = stmt2
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .flatten()
        .collect();
    let mut inserted = 0;
    for sc in &stus {
        for (subj, label) in &ass {
            let has: bool = db
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM scores WHERE student_code=? AND subject=? AND label=?)",
                    params![sc, subj, label],
                    |r| r.get(0),
                )
                .unwrap();
            if !has {
                let id = format!("F-miss-{sc}-{subj}-{label}");
                let n = db
                    .execute(
                        "INSERT OR IGNORE INTO flags(id,student_code,subject,label,rule_id,severity,message,status,created_at) VALUES(?,?,?,?,?,?,?,'open',?)",
                        params![
                            id,
                            sc,
                            subj,
                            label,
                            "VAL-MISS-01",
                            "blocking",
                            format!("{label} ({subj}) is missing for {sc} — reports cannot print until filled."),
                            now_iso()
                        ],
                    )
                    .unwrap();
                inserted += n;
            }
        }
    }
    let out = flags_open(db);
    if inserted > 0 {
        audit(db, &s.username, "flags.scan", "flags", "null", &format!("{inserted} new"));
        persist_state(&state, db)?;
    }
    Ok(out)
}

fn flags_open(db: &Connection) -> Vec<Flag> {
    let mut stmt = db
        .prepare("SELECT id,student_code,subject,label,rule_id,severity,message,status FROM flags WHERE status='open' ORDER BY severity != 'blocking', id")
        .unwrap();
    stmt.query_map([], |r| {
        Ok(Flag {
            id: r.get(0)?,
            student_code: r.get(1)?,
            subject: r.get(2)?,
            label: r.get(3)?,
            rule_id: r.get(4)?,
            severity: r.get(5)?,
            message: r.get(6)?,
            status: r.get(7)?,
        })
    })
    .unwrap()
    .flatten()
    .collect()
}

#[tauri::command]
fn flags(state: State<AppState>) -> Result<Vec<Flag>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    Ok(flags_open(db))
}

#[tauri::command]
fn flag_dispose(
    state: State<AppState>,
    id: String,
    disposition: String,
    note: String,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin", "head", "teacher"])?;
    if !["corrected", "confirmed", "escalated"].contains(&disposition.as_str()) {
        return Err("unknown disposition".into());
    }
    if disposition == "confirmed" && note.trim().is_empty() {
        return Err("confirmed disposition requires a reason note".into());
    }
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let n = db
        .execute(
            "UPDATE flags SET status='resolved', disposition=?, actor=?, note=? WHERE id=? AND status='open'",
            params![disposition, s.username, note, id],
        )
        .unwrap();
    if n == 0 {
        return Err("flag not found or already resolved".into());
    }
    audit(
        db,
        &s.username,
        &format!("flag.{disposition}"),
        &id,
        "open",
        "resolved",
    );
    persist_state(&state, db)?;
    Ok("resolved".into())
}

#[tauri::command]
fn comment_pick(state: State<AppState>, subject: String, band: String) -> Result<Vec<Template>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    Ok(bank()
        .into_iter()
        .filter(|(s, b, _, _)| *s == subject && *b == band)
        .enumerate()
        .map(|(i, (s, b, tone, text))| Template {
            id: format!("{}-{}-{}-{:02}", s.to_lowercase(), b.to_lowercase(), tone, i),
            subject: s.into(),
            band: b.into(),
            text: text.into(),
            max_chars: 210,
        })
        .collect())
}

#[tauri::command]
fn comment_preview(
    state: State<AppState>,
    template_id: String,
    ctx: Ctx,
) -> Result<serde_json::Value, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let (subj, band) = template_id
        .split_once('-')
        .map(|_| ())
        .map(|_| {
            let parts: Vec<&str> = template_id.split('-').collect();
            (
                parts.first().unwrap_or(&"maths").to_uppercase(),
                parts.get(1).unwrap_or(&"b").to_uppercase(),
            )
        })
        .unwrap();
    let t = bank()
        .into_iter()
        .filter(|(s, b, _, _)| *s == subj && *b == band)
        .enumerate()
        .map(|(i, (s, b, tone, text))| Template {
            id: format!("{}-{}-{}-{:02}", s.to_lowercase(), b.to_lowercase(), tone, i),
            subject: s.into(),
            band: b.into(),
            text: text.into(),
            max_chars: 210,
        })
        .find(|t| t.id == template_id)
        .ok_or("unknown template")?;
    let text = t
        .text
        .replace("{name}", &ctx.name)
        .replace("{subject}", &ctx.subject)
        .replace("{score}", &ctx.score)
        .replace("{strength}", &ctx.strength)
        .replace("{next_step}", &ctx.next_step);
    Ok(serde_json::json!({
        "text": text,
        "chars": text.chars().count(),
        "blocked": text.chars().count() > 210
    }))
}

#[tauri::command]
fn comment_save(
    state: State<AppState>,
    student: String,
    subject: String,
    term: String,
    template_id: Option<String>,
    text: String,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin", "teacher"])?;
    if text.chars().count() > 500 {
        return Err("VAL-COMLEN-01: comment too long".into());
    }
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    db.execute(
        "INSERT OR REPLACE INTO comments(student_code,subject,term,template_id,final_text,author) VALUES(?,?,?,?,?,?)",
        params![student, subject, term, template_id, text, s.username],
    )
    .unwrap();
    audit(
        db,
        &s.username,
        "comment.save",
        &format!("{student}/{subject}"),
        "null",
        &text,
    );
    persist_state(&state, db)?;
    Ok("saved".into())
}

// ---------- reports ----------
fn hub_keys(db: &Connection) -> (SigningKey, VerifyingKey) {
    if let Some(priv_hex) = meta_get(db, "hub_priv") {
        let bytes: [u8; 32] = hex::decode(priv_hex)
            .unwrap_or_default()
            .try_into()
            .unwrap_or([0u8; 32]);
        let sk = SigningKey::from_bytes(&bytes);
        let vk = sk.verifying_key();
        if meta_get(db, "hub_pub").is_none() {
            let _ = db.execute(
                "INSERT OR REPLACE INTO meta(k,v) VALUES('hub_pub',?)",
                [hex::encode(vk.as_bytes())],
            );
        }
        return (sk, vk);
    }
    let sk = SigningKey::generate(&mut rand::rngs::OsRng);
    let vk = sk.verifying_key();
    db.execute(
        "INSERT OR REPLACE INTO meta(k,v) VALUES('hub_priv',?)",
        [hex::encode(sk.to_bytes())],
    )
    .unwrap();
    db.execute(
        "INSERT OR REPLACE INTO meta(k,v) VALUES('hub_pub',?)",
        [hex::encode(vk.as_bytes())],
    )
    .unwrap();
    (sk, vk)
}

#[tauri::command]
fn reports_draft_all(state: State<AppState>, term: String) -> Result<i64, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin", "teacher"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db.prepare("SELECT short_code, class, first, last FROM students ORDER BY short_code").unwrap();
    let stus: Vec<(String, String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .flatten()
        .collect();
    let mut stmt2 = db.prepare("SELECT subject, label, max_score, weight FROM assessments").unwrap();
    let ass: Vec<(String, String, f64, f64)> = stmt2
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .flatten()
        .collect();
    let mut made = 0;
    for (sc, class, first, last) in stus {
        let mut complete = true;
        let mut resmap = serde_json::Map::new();
        for subj in ["MATHS", "ENG"] {
            let parts: Vec<(f64, f64, f64)> = ass
                .iter()
                .filter(|(s, _, _, _)| s == subj)
                .map(|(_, label, max, w)| {
                    db.query_row(
                        "SELECT value FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
                        params![sc, subj, label],
                        |r| r.get::<_, f64>(0),
                    )
                    .optional()
                    .unwrap()
                    .map(|v| (v, *max, *w))
                })
                .collect::<Option<Vec<_>>>()
                .unwrap_or_default();
            let expected = ass.iter().filter(|(s, _, _, _)| s == subj).count();
            if parts.len() != expected || expected == 0 {
                complete = false;
                break;
            }
            let total: f64 = parts.iter().map(|(v, _, _)| v).sum();
            let avg_t = weighted_avg_tenths(&parts)?;
            resmap.insert(
                subj.to_string(),
                serde_json::json!({"total": total, "avg": avg_t as f64 / 10.0, "grade": map_grade(avg_t)}),
            );
        }
        if !complete {
            continue;
        }
        let comments: std::collections::HashMap<String, String> = db
            .prepare("SELECT subject, final_text FROM comments WHERE student_code=? AND term=?")
            .unwrap()
            .query_map(params![sc, term], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .flatten()
            .collect();
        let payload = serde_json::json!({
            "student": sc,
            "name": format!("{first} {last}"),
            "class": class,
            "term": term,
            "results": resmap,
            "comments": comments,
            "template": TEMPLATE_VER,
            "rules": rule_version()
        });
        let blob = serde_json::to_string(&payload).unwrap();
        let hash = hex::encode(Sha256::digest(blob.as_bytes()));
        let ver: i64 = db
            .query_row(
                "SELECT COALESCE(MAX(version),0)+1 FROM reports WHERE student_code=? AND term=?",
                params![sc, term],
                |r| r.get(0),
            )
            .unwrap();
        let id = format!("RPT-{term}-{sc}-v{ver}");
        db.execute(
            "INSERT OR REPLACE INTO reports(id,student_code,term,version,payload,hash,signature,status,approvals) VALUES(?,?,?,?,?,?,NULL,'draft','[]')",
            params![id, sc, term, ver, blob, hash],
        )
        .unwrap();
        made += 1;
    }
    audit(db, &s.username, "reports.draft_all", &term, "null", &format!("{made} drafts"));
    persist_state(&state, db)?;
    Ok(made)
}

#[tauri::command]
fn reports(state: State<AppState>) -> Result<Vec<Report>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db
        .prepare("SELECT id,student_code,term,version,status,approvals,hash,COALESCE(signature,'') FROM reports ORDER BY student_code, version")
        .unwrap();
    Ok(stmt
        .query_map([], |r| {
            Ok(Report {
                id: r.get(0)?,
                student_code: r.get(1)?,
                term: r.get(2)?,
                version: r.get(3)?,
                status: r.get(4)?,
                approvals: r.get(5)?,
                hash: r.get(6)?,
                signature: r.get(7)?,
            })
        })
        .unwrap()
        .flatten()
        .collect())
}

#[tauri::command]
fn report_approve(state: State<AppState>, id: String) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let role = s.role.as_str();
    if !["teacher", "head"].contains(&role) {
        return Err("Approval requires a teacher or head account. Admin cannot approve.".into());
    }
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let (status, approvals): (String, String) = db
        .query_row("SELECT status, approvals FROM reports WHERE id=?", [&id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()
        .unwrap()
        .ok_or("unknown report")?;
    let allowed = (role == "teacher" && status == "draft") || (role == "head" && status == "reviewed");
    if !allowed {
        return Err(format!("cannot approve as {role} in status {status}"));
    }
    let mut arr: Vec<serde_json::Value> = serde_json::from_str(&approvals).unwrap();
    arr.push(serde_json::json!({"by": s.username, "role": role}));
    let status2: &str = if role == "teacher" { "reviewed" } else { status.as_str() };
    db.execute(
        "UPDATE reports SET approvals=?, status=? WHERE id=?",
        params![serde_json::to_string(&arr).unwrap(), status2, id],
    )
    .unwrap();
    audit(db, &s.username, &format!("report.{role}_approve"), &id, &status, status2);
    persist_state(&state, db)?;
    Ok(status2.to_string())
}

#[tauri::command]
fn report_lock(state: State<AppState>, id: String) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["head"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let (status, approvals, payload, hash): (String, String, String, String) = db
        .query_row(
            "SELECT status, approvals, payload, hash FROM reports WHERE id=?",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .unwrap()
        .ok_or("unknown report")?;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&approvals).unwrap();
    let roles: Vec<String> = arr
        .iter()
        .filter_map(|a| a.get("role").and_then(|r| r.as_str()).map(String::from))
        .collect();
    if !roles.contains(&"teacher".to_string()) {
        return Err("REP-INT-03: teacher review missing — cannot lock".into());
    }
    if !roles.contains(&"head".to_string()) {
        return Err("head approval missing — approve as head first".into());
    }
    if status == "locked" {
        return Err("already locked".into());
    }
    let check = hex::encode(Sha256::digest(payload.as_bytes()));
    if check != hash {
        return Err("REP-INT-02: payload hash mismatch — regenerate".into());
    }
    let (sk, _) = hub_keys(db);
    let sig = hex::encode(sk.sign(payload.as_bytes()).to_bytes());
    let mut arr2 = arr;
    arr2.push(serde_json::json!({"by": s.username, "role": "lock"}));
    db.execute(
        "UPDATE reports SET signature=?, status='locked', approvals=? WHERE id=?",
        params![sig, serde_json::to_string(&arr2).unwrap(), id],
    )
    .unwrap();
    audit(db, &s.username, "report.lock", &id, &status, "locked");
    persist_state(&state, db)?;
    Ok(format!("AGM1:{id}:{hash}:{sig}"))
}

fn subject_name(s: &str) -> &str {
    match s {
        "MATHS" => "Mathematics",
        "ENG" => "English",
        other => other,
    }
}

fn role_label(r: &str) -> &str {
    match r {
        "teacher" => "Class teacher",
        "head" => "Head",
        other => other,
    }
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[tauri::command]
fn report_html(state: State<AppState>, id: String) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let (payload, status, approvals, hash, signature): (String, String, String, String, String) = db
        .query_row(
            "SELECT payload, status, approvals, hash, COALESCE(signature,'') FROM reports WHERE id=?",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()
        .unwrap()
        .ok_or("unknown report")?;
    let p: serde_json::Value = serde_json::from_str(&payload).unwrap();

    let mut rows = String::new();
    let mut sum = 0.0;
    let mut n = 0usize;
    if let Some(map) = p.get("results").and_then(|r| r.as_object()) {
        let mut entries: Vec<_> = map.iter().collect();
        entries.sort_by(|a, b| a.0.cmp(b.0));
        for (subj, r) in entries {
            let avg = r.get("avg").and_then(|v| v.as_f64()).unwrap_or(0.0);
            sum += avg;
            n += 1;
            rows += &format!(
                "<tr><td>{}</td><td>{:.0}</td><td>{:.1}</td><td><b>{}</b></td></tr>",
                subject_name(subj),
                r.get("total").and_then(|v| v.as_f64()).unwrap_or(0.0),
                avg,
                r.get("grade").and_then(|v| v.as_str()).unwrap_or("?")
            );
        }
    }
    if n > 0 {
        let overall = sum / n as f64;
        rows += &format!(
            "<tr class=\"overall\"><td>Overall</td><td></td><td>{overall:.1}</td><td><b>{}</b></td></tr>",
            map_grade((overall * 10.0).round() as i64)
        );
    }

    let mut comments = String::new();
    if let Some(map) = p.get("comments").and_then(|c| c.as_object()) {
        for (subj, text) in map {
            if let Some(t) = text.as_str() {
                if !t.is_empty() {
                    comments += &format!(
                        "<p><b>{}</b> — {}</p>",
                        subject_name(subj),
                        html_escape(t)
                    );
                }
            }
        }
    }

    let approvals_txt = {
        let arr: Vec<serde_json::Value> = serde_json::from_str(&approvals).unwrap_or_default();
        let mut parts = vec![];
        for a in arr {
            let role = a.get("role").and_then(|v| v.as_str()).unwrap_or("");
            let by = a.get("by").and_then(|v| v.as_str()).unwrap_or("");
            if role.is_empty() || role == "lock" {
                continue;
            }
            parts.push(format!("{}: {}", role_label(role), html_escape(by)));
        }
        if parts.is_empty() {
            "No approvals recorded".to_string()
        } else {
            parts.join(" · ")
        }
    };

    let locked = status == "locked";
    let banner = if locked {
        String::new()
    } else {
        "<div class=\"draft\">DRAFT — NOT OFFICIAL</div>".to_string()
    };
    let verify = if locked {
        format!(
            "Digitally signed · SHA-256 {} · Ed25519 {}… · {}",
            &hash[..hash.len().min(16)],
            &signature[..signature.len().min(16)],
            id
        )
    } else {
        format!("Preview only — not signed. Approve as class teacher and head, then lock to sign. · {id}")
    };

    let student = p.get("student").and_then(|v| v.as_str()).unwrap_or("?");
    let name = p.get("name").and_then(|v| v.as_str()).unwrap_or(student);
    let class = p.get("class").and_then(|v| v.as_str()).unwrap_or("?");
    let term = p.get("term").and_then(|v| v.as_str()).unwrap_or("?");
    let rule_ver = p.get("rules").and_then(|v| v.as_str()).unwrap_or("");
    let school = meta_get(db, "school_name").unwrap_or_else(|| "School".to_string());

    let css = r#"
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #15201a; background: #fff;
           font: 11.5pt/1.55 "Segoe UI", system-ui, -apple-system, sans-serif; }
    .sheet { max-width: 760px; margin: 0 auto; padding: 8px; }
    .draft { border: 3px solid #b3261e; color: #b3261e; text-align: center;
             font-weight: 800; letter-spacing: .18em; padding: 7px; margin-bottom: 16px; }
    header { display: flex; justify-content: space-between; align-items: flex-end;
             gap: 16px; border-bottom: 2px solid #15201a; padding-bottom: 8px; }
    header h1 { font-family: Georgia, "Times New Roman", serif; font-size: 18pt; margin: 0; line-height: 1.15; }
    .sub { font-size: 8pt; letter-spacing: .13em; text-transform: uppercase; color: #5a6b62; }
    .meta { text-align: right; font-size: 9pt; color: #3d4a44; line-height: 1.4; }
    .who { display: flex; justify-content: space-between; align-items: baseline; margin: 16px 0 8px; }
    .who b { font-family: Georgia, serif; font-size: 13.5pt; }
    .who span { font-size: 9pt; color: #5a6b62; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
    th { text-align: left; font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase;
         color: #5a6b62; border-bottom: 1.5px solid #15201a; padding: 6px; }
    td { padding: 7px 6px; border-bottom: 1px solid #e2ded3; }
    th:last-child, td:last-child { text-align: right; }
    tr.overall td { border-top: 1.5px solid #15201a; border-bottom: none; font-weight: 700; }
    .comments { margin-top: 16px; }
    .comments h2 { font-size: 8pt; letter-spacing: .12em; text-transform: uppercase;
                   color: #5a6b62; margin: 0 0 5px; }
    .comments p { margin: 0 0 6px; font-size: 10pt; }
    .sign { display: flex; gap: 40px; margin-top: 34px; }
    .sign div { flex: 1; }
    .sign .line { border-bottom: 1px solid #15201a; height: 30px; }
    .sign small { display: block; font-size: 8pt; color: #5a6b62; margin-top: 4px; }
    .verify { margin-top: 20px; border-top: 1px dashed #c9c3b6; padding-top: 8px;
              font-size: 7.5pt; color: #5a6b62; word-break: break-all; }
    .verify b { color: #14532d; }
    .no-print { text-align: center; margin-top: 22px; }
    .no-print button { font: 600 10pt "Segoe UI", sans-serif; padding: 8px 18px; border: 0;
                       border-radius: 7px; background: #14532d; color: #fff; cursor: pointer; }
    @media print {
      .no-print { display: none; }
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .sheet { max-width: none; padding: 0; }
    }
    "#;

    Ok(format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
         <title>Report Card — {name}</title><style>{css}</style></head><body>\
         <div class=\"sheet\">{banner}\
         <header><div><h1>{school}</h1>\
         <div class=\"sub\">Terminal report · {term}</div></div>\
         <div class=\"meta\">{class}<br>{student}</div></header>\
         <div class=\"who\"><b>{name}</b><span>{term} · {class}</span></div>\
         <table><thead><tr><th>Subject</th><th>Total</th><th>Average</th><th>Grade</th></tr></thead>\
         <tbody>{rows}</tbody></table>\
         {comments_block}\
         <div class=\"sign\"><div><div class=\"line\"></div><small>Class teacher</small></div>\
         <div><div class=\"line\"></div><small>Head of school</small></div>\
         <div><div class=\"line\"></div><small>Date</small></div></div>\
         <div class=\"verify\"><b>{approvals_txt}</b><br>{verify}<br>Rules {rule_ver}</div>\
         <div class=\"no-print\"><button onclick=\"window.print()\">Print</button></div>\
         </div></body></html>",
        student = student,
        name = html_escape(name),
        school = html_escape(&school),
        class = class,
        term = term,
        banner = banner,
        rows = rows,
        css = css,
        comments_block = if comments.is_empty() {
            String::new()
        } else {
            format!("<div class=\"comments\"><h2>Teacher's comment</h2>{comments}</div>")
        },
        approvals_txt = approvals_txt,
        verify = verify,
        rule_ver = rule_ver,
    ))
}

// ---------- backup / restore ----------
fn manifest_sig_bytes(m: &BackupManifest) -> Vec<u8> {
    let mut c = m.clone();
    c.sig.clear();
    serde_json::to_vec(&c).unwrap()
}

fn verify_backup_path(
    path: &Path,
    data_key: &[u8],
    expected_pub: Option<&str>,
) -> Result<(BackupManifest, Connection), String> {
    let manifest_path = path.with_extension("json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Cannot read manifest {}: {e}", manifest_path.display()))?;
    let m: BackupManifest = serde_json::from_str(&raw)
        .map_err(|_| "Backup manifest is corrupt.".to_string())?;
    if m.version != 1 {
        return Err(format!("Unsupported backup version {}.", m.version));
    }
    if let Some(p) = expected_pub {
        if m.hub_pubkey != p {
            return Err("Backup was signed by a different hub key.".into());
        }
    }
    let blob = std::fs::read(path).map_err(|e| format!("Cannot read backup: {e}"))?;
    if store::sha256_hex(&blob) != m.sha256 {
        return Err("Backup SHA-256 does not match its manifest.".into());
    }
    let pub_bytes = hex::decode(&m.hub_pubkey).map_err(|_| "Backup public key is invalid.")?;
    let pub_arr: [u8; 32] = pub_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "Backup public key is invalid.")?;
    let vk = VerifyingKey::from_bytes(&pub_arr).map_err(|_| "Backup public key is invalid.")?;
    let sig_bytes = hex::decode(&m.sig).map_err(|_| "Backup signature is invalid.")?;
    let sig = Signature::from_slice(&sig_bytes).map_err(|_| "Backup signature is invalid.")?;
    vk.verify_strict(&manifest_sig_bytes(&m), &sig)
        .map_err(|_| "Backup manifest signature is invalid.")?;

    let plain = store::decrypt_backup(data_key, &blob)?;
    let db = store::open_from_bytes(&plain)?;
    let (students, scores, reports, audit_rows) = db_counts(&db);
    if (students, scores, reports, audit_rows)
        != (m.students, m.scores, m.reports, m.audit_rows)
    {
        return Err("Backup row counts do not match its manifest.".into());
    }
    if audit_head(&db) != m.audit_head {
        return Err("Backup audit head does not match its manifest.".into());
    }
    if db_digest(&db)? != m.digest {
        return Err("Backup content digest does not match its manifest.".into());
    }
    verify_audit_chain(&db)?;
    Ok((m, db))
}

fn latest_backup_path(db: &Connection) -> Result<PathBuf, String> {
    let p: Option<String> = db
        .query_row(
            "SELECT path FROM backups ORDER BY created_at DESC, rowid DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .optional()
        .unwrap_or(None);
    let p = p.ok_or("No backup found. Run a backup first.")?;
    let path = PathBuf::from(p);
    if !path.exists() {
        return Err("Latest backup file is missing. Run a new backup.".into());
    }
    Ok(path)
}

/// If `vault.json` is gone but the backup folder contains a `vault-BK-*.json`
/// copy written by `backup_create`, adopt the newest one so disaster recovery can
/// unwrap the data key. Returns true when a copy was restored.
fn adopt_vault_from_backup_kit(dir: &Path) -> Result<bool, String> {
    let target = vault::vault_path(dir);
    if target.exists() {
        return Ok(false);
    }
    let bd = dir.join("backups");
    let entries = match std::fs::read_dir(&bd) {
        Ok(e) => e,
        Err(_) => return Ok(false),
    };
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    for entry in entries.flatten() {
        let p = entry.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if name.starts_with("vault-") && name.ends_with(".json") {
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((modified, p));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    if let Some((_, src)) = candidates.into_iter().next() {
        std::fs::copy(&src, &target)
            .map_err(|e| format!("Cannot restore vault.json from {}: {e}", src.display()))?;
        return Ok(true);
    }
    Ok(false)
}

/// Find a backup on disk without a live database. Used by first-run recovery when
/// `hub.db` is gone but `vault.json` and the encrypted backups survived.
fn find_backup_on_disk(dir: &Path, backup_id: Option<String>) -> Result<PathBuf, String> {
    let bd = dir.join("backups");
    if let Some(id) = backup_id.filter(|s| !s.trim().is_empty()) {
        let id = id.trim();
        if id.contains('/') || id.contains('\\') || id.contains("..") {
            return Err("Backup ID must not contain a path.".into());
        }
        let direct = bd.join(format!("{id}.agm"));
        if direct.exists() {
            return Ok(direct);
        }
        let by_name = bd.join(id);
        if by_name.exists() {
            return Ok(by_name);
        }
        return Err(format!(
            "Backup {id} was not found in {}. Copy its .agm and .json files there first.",
            bd.display()
        ));
    }
    let entries = std::fs::read_dir(&bd)
        .map_err(|e| format!("Cannot read the backup folder {}: {e}", bd.display()))?;
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    for entry in entries.flatten() {
        let p = entry.path();
        if p.extension().and_then(|x| x.to_str()) == Some("agm")
            && p.with_extension("json").exists()
        {
            let modified = entry
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((modified, p));
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    candidates
        .into_iter()
        .next()
        .map(|(_, p)| p)
        .ok_or_else(|| {
            "No backup found. Copy the .agm and .json files into the backups folder first."
                .to_string()
        })
}

#[tauri::command]
fn backup_create(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;

    let (sk, vk) = hub_keys(db);
    let bytes = store::serialize_db(db)?;
    let blob = store::encrypt_backup(&s.data_key, &bytes)?;
    let sha = store::sha256_hex(&blob);
    let backup_id = format!("BK-{}-{:04x}", now_iso().trim_start_matches('t'), rand::random::<u16>());
    let bd = state.dir.join("backups");
    std::fs::create_dir_all(&bd).map_err(|e| format!("Cannot create backup folder: {e}"))?;
    let path = bd.join(format!("{backup_id}.agm"));
    store::atomic_write(&path, &blob)?;

    let (students, scores, reports, audit_rows) = db_counts(db);
    let digest = db_digest(db)?;
    let head = audit_head(db);
    let school = meta_get(db, "school_name").unwrap_or_else(|| "School".into());
    let mut m = BackupManifest {
        version: 1,
        backup_id: backup_id.clone(),
        created_at: now_iso(),
        bytes: blob.len(),
        sha256: sha.clone(),
        students,
        scores,
        reports,
        audit_rows,
        audit_head: head,
        digest,
        schema_version: meta_get(db, "schema_version").unwrap_or_else(|| SCHEMA_VERSION.into()),
        school_name: school,
        hub_pubkey: hex::encode(vk.as_bytes()),
        sig: String::new(),
    };
    let sig = sk.sign(&manifest_sig_bytes(&m));
    m.sig = hex::encode(sig.to_bytes());
    let mpath = bd.join(format!("{backup_id}.json"));
    let mraw = serde_json::to_vec_pretty(&m).map_err(|e| format!("Cannot encode manifest: {e}"))?;
    store::atomic_write(&mpath, &mraw)?;

    // Keep a copy of the wrapped-key vault beside the backup. Without it, a
    // backup is unrecoverable if the original PC (and its vault.json) is lost.
    // It contains only Argon2id-wrapped keys, never the plaintext data key.
    let vault_path = vault::vault_path(&state.dir);
    if vault_path.exists() {
        let vraw = std::fs::read(&vault_path)
            .map_err(|e| format!("Cannot read vault.json for the backup kit: {e}"))?;
        store::atomic_write(&bd.join(format!("vault-{backup_id}.json")), &vraw)?;
    }

    // Verify the bytes we just wrote before declaring the backup good.
    let verified = verify_backup_path(&path, &s.data_key, Some(&m.hub_pubkey))?;
    let vm = verified.0;
    let now = now_iso();
    db.execute(
        "INSERT OR REPLACE INTO backups(id,path,sha256,bytes,students,scores,reports,audit_rows,audit_head,digest,created_at,verified_at,manifest_sig) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params![vm.backup_id, path.to_string_lossy(), vm.sha256, vm.bytes as i64, vm.students, vm.scores, vm.reports, vm.audit_rows, vm.audit_head, vm.digest, vm.created_at, now, vm.sig],
    )
    .map_err(|e| format!("Cannot record backup: {e}"))?;
    meta_set(db, "backup_verified", "yes", &s.username);
    meta_set(db, "last_backup_at", &now, &s.username);
    persist_state(&state, db)?;
    Ok(format!(
        "Backup verified: {} ({} bytes, sha256 {}…). Keep a copy off this PC.",
        vm.backup_id,
        vm.bytes,
        &vm.sha256[..vm.sha256.len().min(12)]
    ))
}

#[tauri::command]
fn backup_list(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin", "head"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db
        .prepare("SELECT id,path,sha256,bytes,students,scores,reports,created_at,verified_at FROM backups ORDER BY created_at DESC LIMIT 50")
        .map_err(|e| format!("Cannot list backups: {e}"))?;
    let rows = stmt
        .query_map([], |r| {
            Ok(serde_json::json!({
                "id": r.get::<_, String>(0)?,
                "path": r.get::<_, String>(1)?,
                "sha256": r.get::<_, String>(2)?,
                "bytes": r.get::<_, i64>(3)?,
                "students": r.get::<_, i64>(4)?,
                "scores": r.get::<_, i64>(5)?,
                "reports": r.get::<_, i64>(6)?,
                "created_at": r.get::<_, String>(7)?,
                "verified_at": r.get::<_, Option<String>>(8)?,
            }))
        })
        .map_err(|e| format!("Cannot list backups: {e}"))?;
    Ok(rows.flatten().collect())
}

#[tauri::command]
fn backup_verify(
    state: State<AppState>,
    backup_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let path = match backup_id {
        Some(id) if !id.trim().is_empty() => {
            let p: Option<String> = db
                .query_row("SELECT path FROM backups WHERE id=?", [id.trim()], |r| r.get(0))
                .optional()
                .unwrap_or(None);
            PathBuf::from(p.ok_or("Unknown backup id.")?)
        }
        _ => latest_backup_path(db)?,
    };
    let expected = meta_get(db, "hub_pub");
    let (m, _) = verify_backup_path(&path, &s.data_key, expected.as_deref())?;
    Ok(serde_json::json!({
        "ok": true,
        "backup_id": m.backup_id,
        "sha256": m.sha256,
        "bytes": m.bytes,
        "students": m.students,
        "scores": m.scores,
        "reports": m.reports,
        "audit_rows": m.audit_rows,
        "audit_chain": "ok"
    }))
}

#[tauri::command]
fn drill_run(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let path = match latest_backup_path(db) {
        Ok(p) => p,
        Err(e) => {
            meta_set(db, "drill_passed", "no", &s.username);
            let _ = persist_state(&state, db);
            return Err(e);
        }
    };
    let expected = meta_get(db, "hub_pub");
    match verify_backup_path(&path, &s.data_key, expected.as_deref()) {
        Ok((m, _)) => {
            let now = now_iso();
            meta_set(db, "drill_passed", "yes", &s.username);
            meta_set(db, "last_drill_at", &now, &s.username);
            persist_state(&state, db)?;
            Ok(format!(
                "Drill PASS: restored {} in a scratch database; {} students, {} scores, {} reports, audit chain OK.",
                m.backup_id, m.students, m.scores, m.reports
            ))
        }
        Err(e) => {
            meta_set(db, "drill_passed", "no", &s.username);
            let _ = persist_state(&state, db);
            Err(format!("Drill FAIL: {e}"))
        }
    }
}

#[tauri::command]
fn restore_backup(state: State<AppState>, backup_id: Option<String>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let (manifest, backup_db) = {
        let guard = db_guard(&state)?;
        let db = guard.as_ref().ok_or("Sign in required.")?;
        let path = match backup_id {
            Some(id) if !id.trim().is_empty() => {
                let p: Option<String> = db
                    .query_row("SELECT path FROM backups WHERE id=?", [id.trim()], |r| r.get(0))
                    .optional()
                    .unwrap_or(None);
                PathBuf::from(p.ok_or("Unknown backup id.")?)
            }
            _ => latest_backup_path(db)?,
        };
        let expected = meta_get(db, "hub_pub");
        verify_backup_path(&path, &s.data_key, expected.as_deref())?
    };

    let bd = state.dir.join("backups");
    std::fs::create_dir_all(&bd).map_err(|e| format!("Cannot create backup folder: {e}"))?;
    let current = store::db_path(&state.dir);
    if current.exists() {
        let archive = bd.join(format!("pre-restore-{}.db", now_iso()));
        std::fs::copy(&current, &archive)
            .map_err(|e| format!("Cannot archive current database: {e}"))?;
    }

    let mut guard = db_guard(&state)?;
    let old = guard.take();
    *guard = Some(backup_db);
    {
        let db = guard.as_ref().ok_or("Restore failed.")?;
        if let Err(e) = persist_state(&state, db) {
            *guard = old;
            return Err(e);
        }
        audit(db, &s.username, "db.restore", &manifest.backup_id, "null", "restored");
        meta_set(db, "last_restore_at", &now_iso(), &s.username);
        persist_state(&state, db)?;
    }
    drop(old);
    Ok(format!(
        "Restored {}. The previous database was archived in backups/.",
        manifest.backup_id
    ))
}

/// First-run / disaster recovery: unlock with a vault account and restore a backup
/// from disk even when `hub.db` is missing. The current database, if any, is archived.
#[tauri::command]
fn recover_from_backup(
    state: State<AppState>,
    username: String,
    password: String,
    backup_id: Option<String>,
) -> Result<UnlockResult, String> {
    if let Some(secs) = auth_lockout_secs(&state) {
        return Err(format!(
            "Too many failed attempts. Try again in {secs} seconds."
        ));
    }
    adopt_vault_from_backup_kit(&state.dir)?;
    ensure_vault_loaded(&state)?;
    let vg = state.vault.lock().map_err(|_| "Vault state unavailable.")?;
    let v = vg.as_ref().ok_or("This hub is not initialized.")?;
    let u: &VaultUser = match v.find(&username) {
        Some(u) => u,
        None => {
            drop(vg);
            record_auth_failure(&state);
            return Err("Invalid username or password.".into());
        }
    };
    let aad = format!("AGM-VAULT-USER-V1|{}", u.username);
    let data_key = match vault::unwrap_key(&password, &u.wrapped, aad.as_bytes()) {
        Ok(k) => k,
        Err(_) => {
            drop(vg);
            record_auth_failure(&state);
            return Err("Invalid username or password.".into());
        }
    };
    let role = u.role.clone();
    let must_change = u.must_change;
    let canonical_username = u.username.clone();
    drop(vg);
    clear_auth_failures(&state);

    if role != "admin" && role != "head" {
        return Err("Restoring a backup requires an admin or head account.".into());
    }

    let path = find_backup_on_disk(&state.dir, backup_id)?;
    let (manifest, backup_db) = verify_backup_path(&path, &data_key, None)?;

    let current = store::db_path(&state.dir);
    if current.exists() {
        let bd = state.dir.join("backups");
        std::fs::create_dir_all(&bd).map_err(|e| format!("Cannot create backup folder: {e}"))?;
        let archive = bd.join(format!("pre-recover-{}.db", now_iso()));
        std::fs::copy(&current, &archive)
            .map_err(|e| format!("Cannot archive the current database: {e}"))?;
    }

    *state.db.lock().map_err(|_| "Database state unavailable.")? = Some(backup_db);
    *state.session.lock().map_err(|_| "Session state unavailable.")? = Some(Session {
        username: canonical_username.clone(),
        role: role.clone(),
        data_key,
        must_change,
    });
    *state.last_activity.lock().map_err(|_| "Session state unavailable.")? = Instant::now();

    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Recovery failed.")?;
    audit(
        db,
        &canonical_username,
        "db.recover",
        &manifest.backup_id,
        "null",
        "restored from backup kit",
    );
    meta_set(db, "last_restore_at", &now_iso(), &canonical_username);
    meta_set(db, "backup_verified", "yes", &canonical_username);
    // A restore is not a drill: the school must run a fresh drill on this PC.
    meta_set(db, "drill_passed", "no", &canonical_username);
    persist_state(&state, db)?;

    Ok(UnlockResult {
        username: canonical_username,
        role,
        must_change,
    })
}

#[tauri::command]
fn clear_demo(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    if meta_get(db, "data_mode").as_deref() == Some("real") {
        return Err("Refusing to clear data in real-data mode.".into());
    }
    db.execute("DELETE FROM scores", []).unwrap();
    db.execute("DELETE FROM students", []).unwrap();
    db.execute("DELETE FROM flags", []).unwrap();
    db.execute("DELETE FROM reports", []).unwrap();
    db.execute("DELETE FROM comments", []).unwrap();
    meta_set(db, "demo_cleared", "yes", &s.username);
    meta_set(db, "backup_verified", "no", &s.username);
    meta_set(db, "drill_passed", "no", &s.username);
    meta_set(db, "privacy_ack", "no", &s.username);
    audit(db, &s.username, "demo.clear", "school", "demo", "empty");
    persist_state(&state, db)?;
    Ok("Demo data cleared. Run a backup and drill on the empty database, acknowledge privacy, then enable real mode.".into())
}

#[tauri::command]
fn privacy_ack(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    meta_set(db, "privacy_ack", "yes", &s.username);
    meta_set(db, "privacy_ack_at", &now_iso(), &s.username);
    meta_set(db, "privacy_ack_by", &s.username, &s.username);
    persist_state(&state, db)?;
    Ok("Privacy notice acknowledged.".into())
}

fn real_data_test_override_available() -> bool {
    (cfg!(debug_assertions) || cfg!(feature = "allow-real-data-test"))
        && std::env::var("AGM_TEST_ALLOW_REAL_DATA").ok().as_deref() == Some("1")
}

#[tauri::command]
fn enable_real_mode(
    state: State<AppState>,
    test_override_reason: Option<String>,
) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    if meta_get(db, "data_mode").as_deref() == Some("real") {
        return Ok("Already in real-data mode.".into());
    }
    let (students, scores, reports, _) = db_counts(db);
    if students > 0 || scores > 0 || reports > 0 {
        return Err("Enable blocked: demo data is still present. Clear demo data first, then re-run backup and drill.".into());
    }

    let mut gate = vec![];
    let school = meta_get(db, "school_name").unwrap_or_default();
    if school.trim().is_empty() || school == "School" {
        gate.push("school name not set");
    }
    if meta_get(db, "backup_verified").as_deref() != Some("yes") {
        gate.push("no verified backup");
    }
    if meta_get(db, "drill_passed").as_deref() != Some("yes") {
        gate.push("restore drill not passed");
    }
    if meta_get(db, "privacy_ack").as_deref() != Some("yes") {
        gate.push("privacy notice not acknowledged");
    }

    let reason = test_override_reason.unwrap_or_default().trim().to_string();
    let override_available = real_data_test_override_available();
    if override_available && !reason.is_empty() && reason.chars().count() < 12 {
        return Err("Test override reason must be at least 12 characters.".into());
    }
    let override_active = override_available && reason.chars().count() >= 12;
    if !gate.is_empty() && !override_active {
        return Err(format!("Enable blocked: {}.", gate.join("; ")));
    }

    meta_set(db, "data_mode", "real", &s.username);
    meta_set(db, "live", "yes", &s.username);
    if !gate.is_empty() {
        meta_set(db, "test_override", "yes", &s.username);
        meta_set(db, "test_override_reason", &reason, &s.username);
        meta_set(db, "test_override_at", &now_iso(), &s.username);
        meta_set(db, "test_override_by", &s.username, &s.username);
        audit(
            db,
            &s.username,
            "real_mode.test_override",
            "school",
            "demo",
            &format!("production gate bypassed: {reason}"),
        );
    }
    persist_state(&state, db)?;
    if !gate.is_empty() {
        Ok("REAL DATA TEST MODE enabled. The production gate was bypassed; use test data only.".into())
    } else {
        Ok("REAL DATA MODE enabled. Import only authorized student data.".into())
    }
}

#[tauri::command]
fn audit_list(state: State<AppState>) -> Result<Vec<AuditRow>, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    let mut stmt = db
        .prepare("SELECT seq, actor, action, entity FROM audit ORDER BY seq DESC LIMIT 200")
        .unwrap();
    Ok(stmt
        .query_map([], |r| {
            Ok(AuditRow {
                seq: r.get(0)?,
                actor: r.get(1)?,
                action: r.get(2)?,
                entity: r.get(3)?,
            })
        })
        .unwrap()
        .flatten()
        .collect())
}

#[tauri::command]
fn school_get(state: State<AppState>) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    Ok(meta_get(db, "school_name").unwrap_or_else(|| "School".to_string()))
}

#[tauri::command]
fn school_set(state: State<AppState>, name: String) -> Result<String, String> {
    let s = session_snapshot(&state)?;
    require_active(&s)?;
    require_role(&s, &["admin"])?;
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 80 {
        return Err("School name must be 1–80 characters.".into());
    }
    let guard = db_guard(&state)?;
    let db = guard.as_ref().ok_or("Sign in required.")?;
    meta_set(db, "school_name", n, &s.username);
    persist_state(&state, db)?;
    Ok(n.to_string())
}

// ---------- comment bank ----------
fn bank() -> Vec<(&'static str, &'static str, &'static str, &'static str)> {
    vec![
        ("MATHS", "A", "enc", "{name} has been outstanding in {subject} with {score}%. Keep up the excellent work on {strength}."),
        ("MATHS", "B", "enc", "{name} is doing very well in {subject} ({score}%). Steady work on {strength} shows. {next_step}."),
        ("MATHS", "C", "enc", "{name} is steady in {subject} ({score}%). Focus on {next_step} to lift into the next band."),
        ("MATHS", "D", "firm", "{name} is finding {subject} difficult ({score}%). {next_step} every week is required."),
        ("MATHS", "F", "formal", "{name} has not met the standard in {subject} ({score}%). A meeting is advised to plan {next_step}."),
        ("ENG", "A", "enc", "{name} writes and reads with excellence in {subject} ({score}%). {strength} stands out."),
        ("ENG", "B", "enc", "{name} is strong in {subject} ({score}%). Keep building {strength}. {next_step}."),
        ("ENG", "C", "enc", "{name} is steady in {subject} ({score}%). {next_step} will lift the next result."),
        ("ENG", "D", "firm", "{name} finds {subject} difficult ({score}%). Regular work on {next_step} is required."),
        ("ENG", "F", "formal", "{name} is below standard in {subject} ({score}%). A meeting is advised to plan {next_step}."),
    ]
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = match std::env::var("AGM_DATA_DIR") {
                Ok(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
                _ => app.path().app_data_dir().unwrap().join("agent-mark-hub"),
            };
            std::fs::create_dir_all(&dir).map_err(|e| std::io::Error::other(e.to_string()))?;
            std::fs::create_dir_all(dir.join("backups"))
                .map_err(|e| std::io::Error::other(e.to_string()))?;
            let (vault, vault_error) = match Vault::load(&vault::vault_path(&dir)) {
                Ok(v) => (v, None),
                Err(e) => (None, Some(e)),
            };
            app.manage(AppState {
                dir,
                vault: Mutex::new(vault),
                vault_error: Mutex::new(vault_error),
                session: Mutex::new(None),
                db: Mutex::new(None),
                last_activity: Mutex::new(Instant::now()),
                auth: Mutex::new(AuthThrottle {
                    failures: 0,
                    until: None,
                }),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            vault_status,
            setup,
            unlock,
            lock,
            change_password,
            recovery_reset,
            users_list,
            user_add,
            user_reset_password,
            user_remove,
            dashboard,
            seed_demo,
            students,
            roster_import,
            mobile_import,
            score_add,
            results,
            flags_scan,
            flags,
            flag_dispose,
            comment_pick,
            comment_preview,
            comment_save,
            reports_draft_all,
            reports,
            report_approve,
            report_lock,
            report_html,
            backup_create,
            backup_list,
            backup_verify,
            drill_run,
            restore_backup,
            recover_from_backup,
            clear_demo,
            privacy_ack,
            enable_real_mode,
            audit_list,
            school_get,
            school_set
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}

#[cfg(test)]
mod backup_tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("agm-backup-{tag}-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn test_db() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
             CREATE TABLE students(id TEXT);
             CREATE TABLE assessments(id TEXT);
             CREATE TABLE scores(id TEXT);
             CREATE TABLE flags(id TEXT);
             CREATE TABLE comments(id TEXT);
             CREATE TABLE reports(id TEXT);
             CREATE TABLE audit(seq INTEGER PRIMARY KEY, actor TEXT, action TEXT,
                                entity TEXT, before_json TEXT, after_json TEXT,
                                prev_hash TEXT, hash TEXT);",
        )
        .unwrap();
        db.execute("INSERT INTO students(id) VALUES('S1')", []).unwrap();
        let prev = "GENESIS";
        let body = format!("admin|test|school|null|ok|{prev}");
        let hash = hex::encode(Sha256::digest(body.as_bytes()));
        db.execute(
            "INSERT INTO audit(seq,actor,action,entity,before_json,after_json,prev_hash,hash)
             VALUES(1,'admin','test','school','null','ok',?,?)",
            params![prev, hash],
        )
        .unwrap();
        db
    }

    fn make_backup(dir: &Path, key: &[u8], db: &Connection) -> (PathBuf, BackupManifest) {
        let sk = SigningKey::generate(&mut rand::rngs::OsRng);
        let vk = sk.verifying_key();
        let bytes = store::serialize_db(db).unwrap();
        let blob = store::encrypt_backup(key, &bytes).unwrap();
        let sha = store::sha256_hex(&blob);
        let (students, scores, reports, audit_rows) = db_counts(db);
        let mut m = BackupManifest {
            version: 1,
            backup_id: "BK-TEST".into(),
            created_at: "2026-01-01T00:00:00Z".into(),
            bytes: blob.len(),
            sha256: sha,
            students,
            scores,
            reports,
            audit_rows,
            audit_head: audit_head(db),
            digest: db_digest(db).unwrap(),
            schema_version: "2".into(),
            school_name: "Test School".into(),
            hub_pubkey: hex::encode(vk.as_bytes()),
            sig: String::new(),
        };
        m.sig = hex::encode(sk.sign(&manifest_sig_bytes(&m)).to_bytes());
        let path = dir.join("BK-TEST.agm");
        store::atomic_write(&path, &blob).unwrap();
        let mpath = path.with_extension("json");
        store::atomic_write(&mpath, &serde_json::to_vec_pretty(&m).unwrap()).unwrap();
        (path, m)
    }

    #[test]
    fn valid_backup_restores_into_a_fresh_database() {
        let dir = temp_dir("valid");
        let key = [11u8; 32];
        let (path, m) = make_backup(&dir, &key, &test_db());
        let (vm, restored) = verify_backup_path(&path, &key, Some(&m.hub_pubkey)).unwrap();
        assert_eq!(vm.backup_id, "BK-TEST");
        let n: i64 = restored
            .query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        verify_audit_chain(&restored).unwrap();
    }

    #[test]
    fn tampered_backup_bytes_are_rejected() {
        let dir = temp_dir("bytes");
        let key = [12u8; 32];
        let (path, m) = make_backup(&dir, &key, &test_db());
        let mut raw = std::fs::read(&path).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0x01;
        std::fs::write(&path, raw).unwrap();
        let err = verify_backup_path(&path, &key, Some(&m.hub_pubkey)).unwrap_err();
        assert!(err.contains("SHA-256"), "unexpected error: {err}");
    }

    #[test]
    fn tampered_manifest_is_rejected() {
        let dir = temp_dir("manifest");
        let key = [13u8; 32];
        let (path, mut m) = make_backup(&dir, &key, &test_db());
        m.students = 999;
        let mpath = path.with_extension("json");
        store::atomic_write(&mpath, &serde_json::to_vec_pretty(&m).unwrap()).unwrap();
        let err = verify_backup_path(&path, &key, Some(&m.hub_pubkey)).unwrap_err();
        assert!(err.contains("signature"), "unexpected error: {err}");
    }

    #[test]
    fn backup_signed_by_another_hub_key_is_rejected() {
        let dir = temp_dir("other-key");
        let key = [14u8; 32];
        let (path, _) = make_backup(&dir, &key, &test_db());
        let other = hex::encode(SigningKey::generate(&mut rand::rngs::OsRng).verifying_key().as_bytes());
        let err = verify_backup_path(&path, &key, Some(&other)).unwrap_err();
        assert!(err.contains("different hub key"), "unexpected error: {err}");
    }

    #[test]
    fn missing_manifest_is_rejected() {
        let dir = temp_dir("no-manifest");
        let key = [15u8; 32];
        let (path, m) = make_backup(&dir, &key, &test_db());
        std::fs::remove_file(path.with_extension("json")).unwrap();
        let err = verify_backup_path(&path, &key, Some(&m.hub_pubkey)).unwrap_err();
        assert!(err.contains("manifest"), "unexpected error: {err}");
    }

    #[test]
    fn decrypts_a_pwa_generated_mobile_export() {
        // Generated by hub-desktop/tools/make_mobile_fixture.js using WebCrypto.
        // This proves the Rust desktop and the browser use the same PBKDF2/AES-GCM format.
        let file = include_bytes!("../tests/fixtures/mobile-export.agmm");
        let v = decrypt_mobile_export(file, "Transfer-Passphrase-2026!").unwrap();
        assert_eq!(v["version"], 2);
        assert_eq!(v["students"][0]["code"], "26-JSS2A-001");
        assert_eq!(v["students"][0]["name"], "Ada Demo");
        assert_eq!(v["scores"]["26-JSS2A-001|MATHS|CA1"]["v"], 17.0);
        assert!(decrypt_mobile_export(file, "wrong-transfer-passphrase").is_err());
    }

    #[test]
    fn finds_a_backup_on_disk_without_a_live_database() {
        let dir = temp_dir("disk-backup");
        let bd = dir.join("backups");
        std::fs::create_dir_all(&bd).unwrap();
        std::fs::write(bd.join("BK-ONE.agm"), b"blob").unwrap();
        std::fs::write(bd.join("BK-ONE.json"), b"{}").unwrap();
        std::fs::write(bd.join("ignore.db"), b"x").unwrap();

        let found = find_backup_on_disk(&dir, None).unwrap();
        assert_eq!(found.file_name().unwrap(), "BK-ONE.agm");
        let explicit = find_backup_on_disk(&dir, Some("BK-ONE".into())).unwrap();
        assert_eq!(explicit, found);
        assert!(find_backup_on_disk(&dir, Some("BK-MISSING".into())).is_err());
    }

    #[test]
    fn adopts_a_vault_copy_from_the_backup_kit() {
        let dir = temp_dir("adopt-vault");
        let bd = dir.join("backups");
        std::fs::create_dir_all(&bd).unwrap();
        std::fs::write(bd.join("vault-BK-ONE.json"), b"wrapped-keys").unwrap();

        assert!(adopt_vault_from_backup_kit(&dir).unwrap());
        assert_eq!(
            std::fs::read(dir.join("vault.json")).unwrap(),
            b"wrapped-keys"
        );
        // An existing vault is never overwritten by the kit copy.
        std::fs::write(dir.join("vault.json"), b"live-vault").unwrap();
        assert!(!adopt_vault_from_backup_kit(&dir).unwrap());
        assert_eq!(std::fs::read(dir.join("vault.json")).unwrap(), b"live-vault");
    }
}
