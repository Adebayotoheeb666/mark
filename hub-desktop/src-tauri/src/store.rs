//! Whole-database AEAD store.
//!
//! SQLite runs in memory while the app is unlocked. Every mutation is serialized and
//! sealed with XChaCha20-Poly1305 before it touches disk. This gives us at-rest
//! encryption without requiring a SQLCipher build, and keeps plaintext student data out
//! of `hub.db`, WAL files, and temp files.

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use rusqlite::serialize::OwnedData;
use rusqlite::{ffi, Connection, DatabaseName};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use zeroize::Zeroizing;

pub const DB_MAGIC: &[u8; 8] = b"AGMDB001";
pub const BACKUP_MAGIC: &[u8; 8] = b"AGMBK001";
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;

pub fn db_path(dir: &Path) -> PathBuf {
    dir.join("hub.db")
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create data directory: {e}"))?;
    }
    let tmp = sibling(path, ".tmp");
    let bak = sibling(path, ".bak");
    let mut f = std::fs::File::create(&tmp)
        .map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    f.write_all(bytes)
        .map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
    f.sync_all()
        .map_err(|e| format!("Cannot flush {}: {e}", tmp.display()))?;
    drop(f);

    if path.exists() {
        if bak.exists() {
            let _ = std::fs::remove_file(&bak);
        }
        std::fs::rename(path, &bak)
            .map_err(|e| format!("Cannot rotate {}: {e}", path.display()))?;
    }
    match std::fs::rename(&tmp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            if bak.exists() {
                let _ = std::fs::rename(&bak, path);
            }
            Err(format!("Cannot install {}: {e}", path.display()))
        }
    }
}

pub fn encrypt_blob(magic: &[u8; 8], key: &[u8], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "invalid key")?;
    let mut nonce = [0u8; NONCE_LEN];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plain,
                aad: magic,
            },
        )
        .map_err(|_| "encryption failed")?;
    let mut out = Vec::with_capacity(8 + NONCE_LEN + ct.len());
    out.extend_from_slice(magic);
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn decrypt_blob(magic: &[u8; 8], key: &[u8], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() < 8 + NONCE_LEN + TAG_LEN {
        return Err("Encrypted file is truncated.".into());
    }
    if &blob[..8] != magic {
        return Err("Encrypted file has the wrong format.".into());
    }
    let cipher = XChaCha20Poly1305::new_from_slice(key).map_err(|_| "invalid key")?;
    let nonce = &blob[8..8 + NONCE_LEN];
    let ct = &blob[8 + NONCE_LEN..];
    cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ct,
                aad: magic,
            },
        )
        .map_err(|_| "Wrong password or damaged encrypted file.".to_string())
}

pub fn is_plaintext_sqlite(path: &Path) -> bool {
    use std::io::Read;
    let mut f = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return false,
    };
    let mut h = [0u8; 16];
    if f.read_exact(&mut h).is_err() {
        return false;
    }
    &h == b"SQLite format 3\0"
}

pub fn serialize_db(db: &Connection) -> Result<Vec<u8>, String> {
    let data = db
        .serialize(DatabaseName::Main)
        .map_err(|e| format!("Cannot serialize database: {e}"))?;
    Ok(data.to_vec())
}

fn owned_from_vec(bytes: Vec<u8>) -> Result<OwnedData, String> {
    let len = bytes.len();
    if len == 0 {
        return Err("Empty database payload.".into());
    }
    let ptr = unsafe { ffi::sqlite3_malloc64(len as u64) as *mut u8 };
    let ptr = NonNull::new(ptr).ok_or("Out of memory while opening database.")?;
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.as_ptr(), len);
    }
    Ok(unsafe { OwnedData::from_raw_nonnull(ptr, len) })
}

pub fn open_from_bytes(bytes: &[u8]) -> Result<Connection, String> {
    let mut db = Connection::open_in_memory().map_err(|e| format!("Cannot open in-memory database: {e}"))?;
    let owned = owned_from_vec(bytes.to_vec())?;
    db.deserialize(DatabaseName::Main, owned, false)
        .map_err(|e| format!("Cannot deserialize database: {e}"))?;
    db.execute_batch(
        "PRAGMA journal_mode=MEMORY;
         PRAGMA synchronous=OFF;
         PRAGMA temp_store=MEMORY;
         PRAGMA secure_delete=ON;",
    )
    .map_err(|e| format!("Cannot configure database: {e}"))?;
    Ok(db)
}

pub fn open_existing(dir: &Path, data_key: &[u8]) -> Result<Connection, String> {
    let path = db_path(dir);
    if !path.exists() {
        // A crash between the two atomic-write renames can leave only the .bak.
        let bak = sibling(&path, ".bak");
        if bak.exists() {
            std::fs::rename(&bak, &path)
                .map_err(|e| format!("Cannot recover hub.db from its backup: {e}"))?;
        } else {
            return Err("The encrypted database is missing. Restore hub.db and vault.json from the school backup kit.".into());
        }
    }
    if is_plaintext_sqlite(&path) {
        return Err("This is a legacy plaintext database. Run setup to migrate it into the encrypted vault.".into());
    }
    let blob = std::fs::read(&path).map_err(|e| format!("Cannot read hub.db: {e}"))?;
    let plain = decrypt_blob(DB_MAGIC, data_key, &blob)?;
    let db = open_from_bytes(&plain)?;
    let check: String = db
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|e| format!("Cannot check database: {e}"))?;
    if check != "ok" {
        return Err(format!("Database integrity check failed: {check}"));
    }
    Ok(db)
}

pub fn open_encrypted(dir: &Path, data_key: &[u8], schema: &str) -> Result<Connection, String> {
    let path = db_path(dir);
    if path.exists() {
        return open_existing(dir, data_key);
    }
    let db = Connection::open_in_memory().map_err(|e| format!("Cannot open database: {e}"))?;
    db.execute_batch(schema)
        .map_err(|e| format!("Cannot create schema: {e}"))?;
    persist(dir, &db, data_key)?;
    Ok(db)
}

/// Migrate an existing plaintext `hub.db` into the encrypted format. The original file is
/// archived beside the new one; it is never silently deleted.
pub fn migrate_legacy(dir: &Path, data_key: &[u8], schema: &str) -> Result<Connection, String> {
    let path = db_path(dir);
    if !path.exists() {
        return open_encrypted(dir, data_key, schema);
    }
    if !is_plaintext_sqlite(&path) {
        return Err("hub.db is already encrypted, but vault.json is missing. Restore vault.json from the backup kit.".into());
    }
    let legacy = Connection::open(&path).map_err(|e| format!("Cannot open legacy database: {e}"))?;
    let _ = legacy.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
    let bytes = serialize_db(&legacy)?;
    drop(legacy);

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let archive = sibling(&path, &format!(".plaintext-{ts}"));
    std::fs::rename(&path, &archive)
        .map_err(|e| format!("Cannot archive legacy database: {e}"))?;
    for suffix in ["-wal", "-shm"] {
        let p = sibling(&path, suffix);
        if p.exists() {
            let _ = std::fs::rename(&p, sibling(&archive, suffix));
        }
    }

    let encrypted = encrypt_blob(DB_MAGIC, data_key, &bytes)?;
    atomic_write(&path, &encrypted)?;
    let db = open_from_bytes(&bytes)?;
    db.execute_batch(schema)
        .map_err(|e| format!("Cannot migrate schema: {e}"))?;
    persist(dir, &db, data_key)?;
    Ok(db)
}

pub fn persist(dir: &Path, db: &Connection, data_key: &[u8]) -> Result<(), String> {
    let bytes = serialize_db(db)?;
    let blob = encrypt_blob(DB_MAGIC, data_key, &bytes)?;
    atomic_write(&db_path(dir), &blob)
}

pub fn backup_key(data_key: &[u8]) -> Zeroizing<Vec<u8>> {
    let mut h = Sha256::new();
    h.update(b"AGM-BACKUP-KEY-V1");
    h.update(data_key);
    Zeroizing::new(h.finalize().to_vec())
}

pub fn encrypt_backup(data_key: &[u8], db_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let key = backup_key(data_key);
    encrypt_blob(BACKUP_MAGIC, &key, db_bytes)
}

pub fn decrypt_backup(data_key: &[u8], blob: &[u8]) -> Result<Vec<u8>, String> {
    let key = backup_key(data_key);
    decrypt_blob(BACKUP_MAGIC, &key, blob)
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(tag: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let p = std::env::temp_dir().join(format!("agm-store-{tag}-{n}"));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn encrypted_blob_round_trips_and_rejects_wrong_key() {
        let key = [7u8; 32];
        let blob = encrypt_blob(DB_MAGIC, &key, b"student data").unwrap();
        assert_eq!(decrypt_blob(DB_MAGIC, &key, &blob).unwrap(), b"student data");
        assert!(decrypt_blob(DB_MAGIC, &[8u8; 32], &blob).is_err());
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = [1u8; 32];
        let mut blob = encrypt_blob(DB_MAGIC, &key, b"student data").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(decrypt_blob(DB_MAGIC, &key, &blob).is_err());
    }

    #[test]
    fn tampered_backup_is_rejected() {
        let key = [2u8; 32];
        let mut blob = encrypt_backup(&key, b"snapshot").unwrap();
        let last = blob.len() - 1;
        blob[last] ^= 0x01;
        assert!(decrypt_backup(&key, &blob).is_err());
    }

    #[test]
    fn missing_database_does_not_silently_recreate() {
        let dir = temp_dir("missing");
        let err = open_existing(&dir, &[3u8; 32]).unwrap_err();
        assert!(err.contains("missing"), "unexpected error: {err}");
        assert!(!db_path(&dir).exists(), "open_existing created a database");
    }

    #[test]
    fn database_persists_encrypted_and_reopens_in_fresh_connection() {
        let dir = temp_dir("reopen");
        let key = [4u8; 32];
        let schema = "CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT); CREATE TABLE t(x TEXT);";
        let db = open_encrypted(&dir, &key, schema).unwrap();
        db.execute("INSERT INTO t(x) VALUES('Ada')", []).unwrap();
        persist(&dir, &db, &key).unwrap();
        drop(db);

        assert!(!is_plaintext_sqlite(&db_path(&dir)));
        let raw = std::fs::read(db_path(&dir)).unwrap();
        assert_eq!(&raw[..8], DB_MAGIC);

        let fresh = open_existing(&dir, &key).unwrap();
        let name: String = fresh.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(name, "Ada");
    }

    #[test]
    fn backup_round_trip_restores_snapshot() {
        let key = [5u8; 32];
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE t(x TEXT);").unwrap();
        db.execute("INSERT INTO t VALUES('Grace')", []).unwrap();
        let bytes = serialize_db(&db).unwrap();
        let blob = encrypt_backup(&key, &bytes).unwrap();
        let plain = decrypt_backup(&key, &blob).unwrap();
        let restored = open_from_bytes(&plain).unwrap();
        let x: String = restored.query_row("SELECT x FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(x, "Grace");
    }
}


