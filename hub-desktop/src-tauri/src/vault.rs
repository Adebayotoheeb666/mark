//! Password-wrapped data-key vault.
//!
//! The SQLite database is encrypted with a random 256-bit data key. That key is never
//! written in plaintext: each staff account gets its own Argon2id-wrapped copy in
//! `vault.json`, and a printed recovery code gets another copy. A stolen disk therefore
//! yields ciphertext + wrapped keys, not student data.

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub const VAULT_VERSION: u32 = 1;
pub const MIN_PASSWORD: usize = 12;
pub const MAX_PASSWORD: usize = 128;
pub const RECOVERY_AAD: &[u8] = b"AGM-VAULT-RECOVERY-V1";

const M_COST: u32 = 65_536; // 64 MiB
const T_COST: u32 = 3;
const P_COST: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct WrappedKey {
    pub salt: String,
    pub nonce: String,
    pub ct: String,
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultUser {
    pub username: String,
    pub role: String,
    pub wrapped: WrappedKey,
    pub created_at: String,
    pub must_change: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Vault {
    pub version: u32,
    pub school_id: String,
    pub created_at: String,
    pub recovery: WrappedKey,
    pub users: Vec<VaultUser>,
}

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let s = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("t{s}")
}

pub fn normalize_username(username: &str) -> String {
    username.trim().to_lowercase()
}

pub fn validate_username(username: &str) -> Result<(), String> {
    if username.len() < 3 || username.len() > 32 {
        return Err("Username must be 3–32 characters.".into());
    }
    if !username
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("Username may only contain letters, digits, dot, underscore or hyphen.".into());
    }
    Ok(())
}

pub fn validate_role(role: &str) -> Result<(), String> {
    if !["admin", "head", "teacher", "viewer"].contains(&role) {
        return Err("Role must be admin, head, teacher or viewer.".into());
    }
    Ok(())
}

pub fn validate_password(password: &str, username: &str) -> Result<(), String> {
    let n = password.chars().count();
    if n < MIN_PASSWORD || n > MAX_PASSWORD {
        return Err(format!(
            "Password must be {MIN_PASSWORD}–{MAX_PASSWORD} characters."
        ));
    }
    if password.eq_ignore_ascii_case(username) {
        return Err("Password must not be the username.".into());
    }
    if password.chars().collect::<std::collections::HashSet<_>>().len() < 4 {
        return Err("Password is too repetitive; use a longer passphrase.".into());
    }
    Ok(())
}

fn user_aad(username: &str) -> Vec<u8> {
    format!("AGM-VAULT-USER-V1|{username}").into_bytes()
}

fn derive_key(secret: &str, salt: &[u8], m_cost: u32, t_cost: u32, p_cost: u32) -> Result<[u8; 32], String> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(32))
        .map_err(|e| format!("KDF parameters rejected: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut out = [0u8; 32];
    argon2
        .hash_password_into(secret.as_bytes(), salt, &mut out)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(out)
}

pub fn wrap_key(secret: &str, data_key: &[u8], aad: &[u8]) -> Result<WrappedKey, String> {
    if data_key.len() != 32 {
        return Err("Data key must be 32 bytes.".into());
    }
    let mut salt = [0u8; 16];
    let mut nonce = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let derived = derive_key(secret, &salt, M_COST, T_COST, P_COST)?;
    let cipher = XChaCha20Poly1305::new_from_slice(&derived).map_err(|_| "cipher init failed")?;
    let ct = cipher
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: data_key,
                aad,
            },
        )
        .map_err(|_| "key wrapping failed")?;
    Ok(WrappedKey {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        ct: hex::encode(ct),
        m_cost: M_COST,
        t_cost: T_COST,
        p_cost: P_COST,
    })
}

pub fn unwrap_key(secret: &str, wrapped: &WrappedKey, aad: &[u8]) -> Result<Zeroizing<Vec<u8>>, String> {
    let salt = hex::decode(&wrapped.salt).map_err(|_| "invalid vault salt")?;
    let nonce = hex::decode(&wrapped.nonce).map_err(|_| "invalid vault nonce")?;
    let ct = hex::decode(&wrapped.ct).map_err(|_| "invalid vault ciphertext")?;
    if nonce.len() != 24 {
        return Err("invalid vault nonce".into());
    }
    let derived = derive_key(
        secret,
        &salt,
        wrapped.m_cost,
        wrapped.t_cost,
        wrapped.p_cost,
    )?;
    let cipher = XChaCha20Poly1305::new_from_slice(&derived).map_err(|_| "cipher init failed")?;
    let pt = cipher
        .decrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: &ct,
                aad,
            },
        )
        .map_err(|_| "Invalid username or password.".to_string())?;
    if pt.len() != 32 {
        return Err("Invalid vault key length.".into());
    }
    Ok(Zeroizing::new(pt))
}

pub fn new_data_key() -> Zeroizing<Vec<u8>> {
    let mut key = vec![0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut key);
    Zeroizing::new(key)
}

pub fn new_school_id() -> String {
    let mut b = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut b);
    hex::encode(b)
}

/// 256-bit recovery code, grouped for printing. Store this offline; it is shown once.
pub fn generate_recovery_code() -> String {
    let mut b = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut b);
    let hex = hex::encode(b).to_uppercase();
    hex.as_bytes()
        .chunks(8)
        .map(|c| std::str::from_utf8(c).unwrap_or("").to_string())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn normalize_recovery(code: &str) -> String {
    code.chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

pub fn recovery_aad() -> &'static [u8] {
    RECOVERY_AAD
}

impl Vault {
    pub fn new(recovery: WrappedKey) -> Self {
        Vault {
            version: VAULT_VERSION,
            school_id: new_school_id(),
            created_at: now_iso(),
            recovery,
            users: Vec::new(),
        }
    }

    pub fn load(path: &Path) -> Result<Option<Vault>, String> {
        let load_path = if path.exists() {
            path.to_path_buf()
        } else {
            let bak = sibling(path, ".bak");
            if bak.exists() {
                bak
            } else {
                return Ok(None);
            }
        };
        let raw = std::fs::read_to_string(&load_path)
            .map_err(|e| format!("Cannot read vault.json: {e}"))?;
        let v: Vault = serde_json::from_str(&raw)
            .map_err(|_| "vault.json is corrupt. Restore the vault file from your backup kit.".to_string())?;
        if v.version != VAULT_VERSION {
            return Err(format!(
                "Unsupported vault version {}. This build expects {VAULT_VERSION}.",
                v.version
            ));
        }
        Ok(Some(v))
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let raw = serde_json::to_vec_pretty(self).map_err(|e| format!("Cannot encode vault: {e}"))?;
        atomic_write(path, &raw)
    }

    pub fn find(&self, username: &str) -> Option<&VaultUser> {
        let u = normalize_username(username);
        self.users.iter().find(|x| x.username == u)
    }

    pub fn admin_count(&self) -> usize {
        self.users.iter().filter(|u| u.role == "admin").count()
    }

    pub fn add_user(
        &mut self,
        username: &str,
        role: &str,
        password: &str,
        data_key: &[u8],
        must_change: bool,
    ) -> Result<(), String> {
        let username = normalize_username(username);
        validate_username(&username)?;
        validate_role(role)?;
        validate_password(password, &username)?;
        if self.find(&username).is_some() {
            return Err("That username already exists.".into());
        }
        let wrapped = wrap_key(password, data_key, &user_aad(&username))?;
        self.users.push(VaultUser {
            username,
            role: role.into(),
            wrapped,
            created_at: now_iso(),
            must_change,
        });
        Ok(())
    }

    pub fn reset_password(
        &mut self,
        username: &str,
        password: &str,
        data_key: &[u8],
        must_change: bool,
    ) -> Result<(), String> {
        let username = normalize_username(username);
        validate_password(password, &username)?;
        let idx = self
            .users
            .iter()
            .position(|u| u.username == username)
            .ok_or("Unknown user.")?;
        let wrapped = wrap_key(password, data_key, &user_aad(&username))?;
        self.users[idx].wrapped = wrapped;
        self.users[idx].must_change = must_change;
        Ok(())
    }

    pub fn remove_user(&mut self, username: &str) -> Result<(), String> {
        let username = normalize_username(username);
        let idx = self
            .users
            .iter()
            .position(|u| u.username == username)
            .ok_or("Unknown user.")?;
        if self.users[idx].role == "admin" && self.admin_count() <= 1 {
            return Err("Cannot remove the last admin account.".into());
        }
        self.users.remove(idx);
        Ok(())
    }

    pub fn public_users(&self) -> Vec<serde_json::Value> {
        self.users
            .iter()
            .map(|u| {
                serde_json::json!({
                    "username": u.username,
                    "role": u.role,
                    "created_at": u.created_at,
                    "must_change": u.must_change,
                })
            })
            .collect()
    }
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_os_string();
    s.push(suffix);
    PathBuf::from(s)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Cannot create data directory: {e}"))?;
    }
    let tmp = sibling(path, ".tmp");
    let bak = sibling(path, ".bak");
    let mut f = std::fs::File::create(&tmp).map_err(|e| format!("Cannot write {}: {e}", tmp.display()))?;
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

pub fn vault_path(dir: &Path) -> PathBuf {
    dir.join("vault.json")
}
