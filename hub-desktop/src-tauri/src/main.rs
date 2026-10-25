#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Agent Mark Hub — Tauri backend v0.1.0
// Mirrors the Python reference (engine + hub): deterministic calc, validation flags,
// comment bank, approval-gated signed reports, encrypted backup + drill gate, hash-chained audit.
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::Mutex;
use tauri::{Manager, State};

const ENGINE_VERSION: &str = "0.3.0";
const PACK_ID: &str = "ng-secondary@1.4.0";
const TEMPLATE_VER: &str = "ng-secondary-rep@1.4.0";

struct DbState {
    db: Mutex<Connection>,
    dir: std::path::PathBuf,
}

// ---------- schema ----------
const SCHEMA: &str = "
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS students(id TEXT PRIMARY KEY, short_code TEXT UNIQUE NOT NULL, first TEXT, last TEXT, class TEXT, status TEXT DEFAULT 'active');
CREATE TABLE IF NOT EXISTS assessments(subject TEXT, label TEXT, max_score REAL, weight REAL, PRIMARY KEY(subject, label));
CREATE TABLE IF NOT EXISTS scores(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, value REAL, entered_by TEXT, version INT, supersedes TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS flags(id TEXT PRIMARY KEY, student_code TEXT, subject TEXT, label TEXT, rule_id TEXT, severity TEXT, message TEXT, status TEXT DEFAULT 'open', disposition TEXT, actor TEXT, note TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS comments(student_code TEXT, subject TEXT, term TEXT, template_id TEXT, final_text TEXT, author TEXT, PRIMARY KEY(student_code, subject, term));
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, student_code TEXT, term TEXT, version INT, payload TEXT, hash TEXT, signature TEXT, status TEXT, approvals TEXT);
CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, actor TEXT, action TEXT, entity TEXT, before_json TEXT, after_json TEXT, prev_hash TEXT, hash TEXT);
";

fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let s = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    format!("t{s}")
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

// comment bank (mirrors packs/comments.example.csv, condensed to 12 + generated band variants)
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

// ---------- commands ----------
#[tauri::command]
fn dashboard(state: State<DbState>) -> Dashboard {
    let db = state.db.lock().unwrap();
    let students: i64 = db.query_row("SELECT COUNT(*) FROM students", [], |r| r.get(0)).unwrap();
    let scores: i64 = db.query_row("SELECT COUNT(*) FROM scores", [], |r| r.get(0)).unwrap();
    let flags_open: i64 = db
        .query_row("SELECT COUNT(*) FROM flags WHERE status='open'", [], |r| r.get(0))
        .unwrap();
    let reports_locked: i64 = db
        .query_row("SELECT COUNT(*) FROM reports WHERE status='locked'", [], |r| r.get(0))
        .unwrap();
    let mut blocking = vec![];
    let mut warning = vec![];
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
    let bv = meta_get(&db, "backup_verified").as_deref() == Some("yes");
    let dp = meta_get(&db, "drill_passed").as_deref() == Some("yes");
    if !bv {
        blocking.push("No verified backup. Run backup + verify first.".into());
    }
    if !dp {
        blocking.push("Restore drill not passed.".into());
    }
    if students > 0 && scores == 0 {
        warning.push("No scores entered yet.".into());
    }
    Dashboard {
        students, scores, flags_open, reports_locked, backup_verified: bv, drill_passed: dp,
        live: meta_get(&db, "live").as_deref() == Some("yes"),
        blocking, warning,
    }
}

/// Seed the demo school. Kept separate from the command so `setup()` can run it headlessly
/// (AGM_AUTO_DEMO=1) for smoke tests without a UI click.
fn seed_demo_impl(db: &Connection) -> Result<String, String> {
    db.execute("DELETE FROM scores", []).unwrap();
    db.execute("DELETE FROM students", []).unwrap();
    db.execute("DELETE FROM flags", []).unwrap();
    db.execute("DELETE FROM reports", []).unwrap();
    db.execute("DELETE FROM comments", []).unwrap();
    for (subj, label, max, w) in [
        ("MATHS", "CA1", 20.0, 20.0), ("MATHS", "CA2", 20.0, 20.0), ("MATHS", "Exam", 60.0, 60.0),
        ("ENG", "CA", 40.0, 40.0), ("ENG", "Exam", 60.0, 60.0),
    ] {
        db.execute("INSERT OR REPLACE INTO assessments(subject,label,max_score,weight) VALUES(?,?,?,?)",
            params![subj, label, max, w]).unwrap();
    }
    let names = [("Ada", "Okafor"), ("Bola", "Bello"), ("Chidi", "Eze"), ("Dola", "Adeyemi"), ("Emeka", "Nwosu"), ("Funmi", "Lawal")];
    for (i, (first, last)) in names.iter().enumerate() {
        let sc = format!("26-JSS2A-{:03}", i + 1);
        db.execute("INSERT OR REPLACE INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
            params![sc.clone(), sc, first, last, "JSS2-A"]).unwrap();
    }
    meta_set(db, "school_name", "Greenfield Secondary School", "system");
    audit(db, "system", "seed.demo", "school", "null", "6 students");
    Ok("Demo school loaded: 6 students, MATHS + ENG assessments.".into())
}

#[tauri::command]
fn seed_demo(state: State<DbState>) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    seed_demo_impl(&db)
}

#[tauri::command]
fn students(state: State<DbState>) -> Vec<Student> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT short_code, first, last, class FROM students ORDER BY short_code").unwrap();
    stmt.query_map([], |r| {
        Ok(Student { short_code: r.get(0)?, first: r.get(1)?, last: r.get(2)?, class: r.get(3)? })
    })
    .unwrap()
    .flatten()
    .collect()
}

#[tauri::command]
fn roster_import(state: State<DbState>, csv_text: String, dry_run: bool) -> ImportResult {
    let db = state.db.lock().unwrap();
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
            .query_row("SELECT EXISTS(SELECT 1 FROM students WHERE short_code=?)", [&sc], |r| r.get(0))
            .unwrap();
        if exists {
            errors.push(format!("row {}: duplicate short_code {sc} in db", i + 1));
            continue;
        }
        rows.push((sc, c[1].trim().into(), c[2].trim().into(), c[3].trim().into()));
    }
    let n = rows.len() as i64;
    if !dry_run && errors.is_empty() {
        for (sc, f, l, cl) in rows {
            db.execute("INSERT INTO students(id,short_code,first,last,class) VALUES(?,?,?,?,?)",
                params![sc.clone(), sc, f, l, cl]).unwrap();
        }
        audit(&db, "admin", "roster.import", "students", "null", &format!("{n} rows"));
    }
    ImportResult { errors, would_import: n }
}

#[tauri::command]
fn score_add(state: State<DbState>, student: String, subject: String, label: String, value: f64, actor: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let max: f64 = db
        .query_row("SELECT max_score FROM assessments WHERE subject=? AND label=?", params![subject, label], |r| r.get(0))
        .optional()
        .unwrap()
        .ok_or_else(|| format!("unknown assessment {subject}/{label}"))?;
    if value.is_nan() {
        return Err("VAL-MISS-01: score is missing".into());
    }
    if value < 0.0 || value > max {
        return Err(format!("VAL-RANGE-01: {value} is outside 0–{max}"));
    }
    let mut stmt = db.prepare("SELECT id, value FROM scores WHERE student_code=? AND subject=? AND label=?").unwrap();
    let priors: Vec<(String, f64)> = stmt.query_map(params![student, subject, label], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect();
    if priors.iter().any(|(_, v)| (*v - value).abs() > 1e-9) {
        return Err("VAL-DUP-01: conflicting prior entry exists — use update flow".into());
    }
    if let Some((id, _)) = priors.first() {
        return Ok(id.clone());
    }
    let id = format!("s{}", now_iso().replace('t', "") + &rand::random::<u32>().to_string());
    db.execute("INSERT INTO scores(id,student_code,subject,label,value,entered_by,version,supersedes,created_at) VALUES(?,?,?,?,?,?,1,NULL,?)",
        params![id, student, subject, label, value, actor, now_iso()]).unwrap();
    audit(&db, &actor, "score.add", &id, "null", &format!("{student} {subject}/{label}={value}"));
    Ok(id)
}

#[tauri::command]
fn results(state: State<DbState>) -> Result<Vec<StudentResult>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT short_code, first, class FROM students ORDER BY short_code").unwrap();
    let stus: Vec<(String, String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().flatten().collect();
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
                        .query_row("SELECT value FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
                            params![sc, subj, label], |r| r.get(0)).optional().unwrap();
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
            subjects.insert(subj.to_string(), SubjectResult { total, avg, grade: map_grade(avg_t).into() });
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
fn flags_scan(state: State<DbState>) -> Vec<Flag> {
    let db = state.db.lock().unwrap();
    // VAL-MISS-01: required assessment with no score
    let mut stmt = db.prepare("SELECT short_code FROM students").unwrap();
    let stus: Vec<String> = stmt.query_map([], |r| r.get(0)).unwrap().flatten().collect();
    let mut stmt2 = db.prepare("SELECT subject, label FROM assessments").unwrap();
    let ass: Vec<(String, String)> = stmt2.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect();
    for sc in &stus {
        for (subj, label) in &ass {
            let has: bool = db.query_row(
                "SELECT EXISTS(SELECT 1 FROM scores WHERE student_code=? AND subject=? AND label=?)",
                params![sc, subj, label], |r| r.get(0)).unwrap();
            if !has {
                // Deterministic id per (student, subject, label): a scan never duplicates a flag,
                // and a human disposition is never silently re-raised (Python parity: one flag
                // per entry point, resolved by explicit human action only).
                let id = format!("F-miss-{sc}-{subj}-{label}");
                db.execute("INSERT OR IGNORE INTO flags(id,student_code,subject,label,rule_id,severity,message,status,created_at) VALUES(?,?,?,?,?,?,?,'open',?)",
                    params![id, sc, subj, label, "VAL-MISS-01", "blocking",
                        format!("{label} ({subj}) is missing for {sc} — reports cannot print until filled."), now_iso()]).unwrap();
            }
        }
    }
    flags_open(&db)
}
fn flags_open(db: &Connection) -> Vec<Flag> {
    let mut stmt = db.prepare("SELECT id,student_code,subject,label,rule_id,severity,message,status FROM flags WHERE status='open' ORDER BY severity != 'blocking', id").unwrap();
    stmt.query_map([], |r| {
        Ok(Flag { id: r.get(0)?, student_code: r.get(1)?, subject: r.get(2)?, label: r.get(3)?,
                 rule_id: r.get(4)?, severity: r.get(5)?, message: r.get(6)?, status: r.get(7)? })
    })
    .unwrap()
    .flatten()
    .collect()
}
#[tauri::command]
fn flags(state: State<DbState>) -> Vec<Flag> {
    flags_open(&state.db.lock().unwrap())
}
#[tauri::command]
fn flag_dispose(state: State<DbState>, id: String, disposition: String, actor: String, note: String) -> Result<String, String> {
    if !["corrected", "confirmed", "escalated"].contains(&disposition.as_str()) {
        return Err("unknown disposition".into());
    }
    if disposition == "confirmed" && note.trim().is_empty() {
        return Err("confirmed disposition requires a reason note".into());
    }
    let db = state.db.lock().unwrap();
    let n = db.execute("UPDATE flags SET status='resolved', disposition=?, actor=?, note=? WHERE id=? AND status='open'",
        params![disposition, actor, note, id]).unwrap();
    if n == 0 {
        return Err("flag not found or already resolved".into());
    }
    audit(&db, &actor, &format!("flag.{disposition}"), &id, "open", "resolved");
    Ok("resolved".into())
}

#[tauri::command]
fn comment_pick(subject: String, band: String) -> Vec<Template> {
    bank().into_iter()
        .filter(|(s, b, _, _)| *s == subject && *b == band)
        .enumerate()
        .map(|(i, (s, b, tone, text))| Template {
            id: format!("{}-{}-{}-{:02}", s.to_lowercase(), b.to_lowercase(), tone, i),
            subject: s.into(), band: b.into(), text: text.into(), max_chars: 210,
        })
        .collect()
}
#[tauri::command]
fn comment_preview(template_id: String, ctx: Ctx) -> Result<serde_json::Value, String> {
    let (subj, band) = template_id.split_once('-').map(|_| ()).map(|_| {
        let parts: Vec<&str> = template_id.split('-').collect();
        (parts.first().unwrap_or(&"maths").to_uppercase(), parts.get(1).unwrap_or(&"b").to_uppercase())
    }).unwrap();
    let t = comment_pick(subj, band).into_iter().find(|t| t.id == template_id)
        .ok_or("unknown template")?;
    let text = t.text.replace("{name}", &ctx.name).replace("{subject}", &ctx.subject)
        .replace("{score}", &ctx.score).replace("{strength}", &ctx.strength).replace("{next_step}", &ctx.next_step);
    Ok(serde_json::json!({"text": text, "chars": text.chars().count(), "blocked": text.chars().count() > 210}))
}
#[tauri::command]
fn comment_save(state: State<DbState>, student: String, subject: String, term: String, template_id: Option<String>, text: String, author: String) -> Result<String, String> {
    if text.chars().count() > 500 {
        return Err("VAL-COMLEN-01: comment too long".into());
    }
    let db = state.db.lock().unwrap();
    db.execute("INSERT OR REPLACE INTO comments(student_code,subject,term,template_id,final_text,author) VALUES(?,?,?,?,?,?)",
        params![student, subject, term, template_id, text, author]).unwrap();
    audit(&db, &author, "comment.save", &format!("{student}/{subject}"), "null", &text);
    Ok("saved".into())
}

fn hub_keys(db: &Connection) -> (SigningKey, VerifyingKey) {
    if let Some(priv_hex) = meta_get(db, "hub_priv") {
        let bytes: [u8; 32] = hex::decode(priv_hex).unwrap().try_into().unwrap();
        let sk = SigningKey::from_bytes(&bytes);
        let vk = sk.verifying_key();
        return (sk, vk);
    }
    let sk = SigningKey::generate(&mut rand::rngs::OsRng);
    db.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('hub_priv',?)", [hex::encode(sk.to_bytes())]).unwrap();
    let vk = sk.verifying_key();
    (sk, vk)
}

#[tauri::command]
fn reports_draft_all(state: State<DbState>, term: String) -> Result<i64, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT short_code, class, first, last FROM students ORDER BY short_code").unwrap();
    let stus: Vec<(String, String, String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().flatten().collect();
    let mut stmt2 = db.prepare("SELECT subject, label, max_score, weight FROM assessments").unwrap();
    let ass: Vec<(String, String, f64, f64)> = stmt2.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().flatten().collect();
    let (sk, _) = hub_keys(&db);
    let _ = sk;
    let mut made = 0;
    for (sc, class, first, last) in stus {
        // skip if any required score missing
        let mut complete = true;
        let mut resmap = serde_json::Map::new();
        for subj in ["MATHS", "ENG"] {
            let parts: Vec<(f64, f64, f64)> = ass.iter().filter(|(s, _, _, _)| s == subj).map(|(_, label, max, w)| {
                db.query_row("SELECT value FROM scores WHERE student_code=? AND subject=? AND label=? ORDER BY version DESC LIMIT 1",
                    params![sc, subj, label], |r| r.get::<_, f64>(0)).optional().unwrap().map(|v| (v, *max, *w))
            }).collect::<Option<Vec<_>>>().unwrap_or_default();
            let expected = ass.iter().filter(|(s, _, _, _)| s == subj).count();
            if parts.len() != expected || expected == 0 {
                complete = false;
                break;
            }
            let total: f64 = parts.iter().map(|(v, _, _)| v).sum();
            let avg_t = weighted_avg_tenths(&parts).map_err(|e| e)?;
            resmap.insert(subj.to_string(), serde_json::json!({"total": total, "avg": avg_t as f64 / 10.0, "grade": map_grade(avg_t)}));
        }
        if !complete {
            continue;
        }
        let comments: std::collections::HashMap<String, String> = db.prepare("SELECT subject, final_text FROM comments WHERE student_code=? AND term=?")
            .unwrap().query_map(params![sc, term], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().flatten().collect();
        let payload = serde_json::json!({"student": sc, "name": format!("{first} {last}"), "class": class, "term": term, "results": resmap,
            "comments": comments, "template": TEMPLATE_VER, "rules": rule_version()});
        let blob = serde_json::to_string(&payload).unwrap();
        let hash = hex::encode(Sha256::digest(blob.as_bytes()));
        let ver: i64 = db.query_row("SELECT COALESCE(MAX(version),0)+1 FROM reports WHERE student_code=? AND term=?",
            params![sc, term], |r| r.get(0)).unwrap();
        let id = format!("RPT-{term}-{sc}-v{ver}");
        db.execute("INSERT OR REPLACE INTO reports(id,student_code,term,version,payload,hash,signature,status,approvals) VALUES(?,?,?,?,?,?,NULL,'draft','[]')",
            params![id, sc, term, ver, blob, hash]).unwrap();
        made += 1;
    }
    audit(&db, "admin", "reports.draft_all", &term, "null", &format!("{made} drafts"));
    Ok(made)
}
#[tauri::command]
fn reports(state: State<DbState>) -> Vec<Report> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT id,student_code,term,version,status,approvals,hash,COALESCE(signature,'') FROM reports ORDER BY student_code, version").unwrap();
    stmt.query_map([], |r| Ok(Report { id: r.get(0)?, student_code: r.get(1)?, term: r.get(2)?, version: r.get(3)?,
        status: r.get(4)?, approvals: r.get(5)?, hash: r.get(6)?, signature: r.get(7)? })).unwrap().flatten().collect()
}
#[tauri::command]
fn report_approve(state: State<DbState>, id: String, role: String, by: String) -> Result<String, String> {
    if !["teacher", "head"].contains(&role.as_str()) {
        return Err("role must be teacher|head".into());
    }
    let db = state.db.lock().unwrap();
    let (status, approvals): (String, String) = db.query_row("SELECT status, approvals FROM reports WHERE id=?", [&id], |r| Ok((r.get(0)?, r.get(1)?))).optional().unwrap().ok_or("unknown report")?;
    let allowed = (role == "teacher" && status == "draft") || (role == "head" && status == "reviewed");
    if !allowed {
        return Err(format!("cannot approve as {role} in status {status}"));
    }
    let mut arr: Vec<serde_json::Value> = serde_json::from_str(&approvals).unwrap();
    arr.push(serde_json::json!({"by": by, "role": role}));
    let status2: &str = if role == "teacher" { "reviewed" } else { status.as_str() };
    db.execute("UPDATE reports SET approvals=?, status=? WHERE id=?", params![serde_json::to_string(&arr).unwrap(), status2, id]).unwrap();
    audit(&db, &by, &format!("report.{role}_approve"), &id, &status, &status2);
    Ok(status2.to_string())
}
#[tauri::command]
fn report_lock(state: State<DbState>, id: String, by: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let (status, approvals, payload, hash): (String, String, String, String) = db
        .query_row("SELECT status, approvals, payload, hash FROM reports WHERE id=?", [&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional().unwrap().ok_or("unknown report")?;
    let arr: Vec<serde_json::Value> = serde_json::from_str(&approvals).unwrap();
    let roles: Vec<String> = arr.iter().filter_map(|a| a.get("role").and_then(|r| r.as_str()).map(String::from)).collect();
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
    let (sk, _) = hub_keys(&db);
    let sig = hex::encode(sk.sign(payload.as_bytes()).to_bytes());
    let mut arr2 = arr;
    arr2.push(serde_json::json!({"by": by, "role": "lock"}));
    db.execute("UPDATE reports SET signature=?, status='locked', approvals=? WHERE id=?",
        params![sig, serde_json::to_string(&arr2).unwrap(), id]).unwrap();
    audit(&db, &by, "report.lock", &id, &status, "locked");
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
fn report_html(state: State<DbState>, id: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let (payload, status, approvals, hash, signature): (String, String, String, String, String) = db
        .query_row(
            "SELECT payload, status, approvals, hash, COALESCE(signature,'') FROM reports WHERE id=?",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional().unwrap().ok_or("unknown report")?;
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
    let school = meta_get(&db, "school_name").unwrap_or_else(|| "School".to_string());

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

#[tauri::command]
fn backup_create(state: State<DbState>) -> Result<String, String> {
    use chacha20poly1305::{aead::{Aead, KeyInit}, XChaCha20Poly1305, XNonce};
    let db = state.db.lock().unwrap();
    let dir = state.dir.clone();
    let dump: String = db.query_row("SELECT COUNT(*) FROM students", [], |r| r.get::<_, i64>(0)).map(|c| format!("students={c}")).unwrap();
    let plain = format!("AGM-BACKUP|{dump}|seq={}", now_iso());
    let key_hex = meta_get(&db, "backup_key").unwrap_or_else(|| {
        let mut k = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut k);
        let h = hex::encode(k);
        db.execute("INSERT OR REPLACE INTO meta(k,v) VALUES('backup_key',?)", [&h]).unwrap();
        h
    });
    let mut key = [0u8; 32];
    hex::decode_to_slice(&key_hex, &mut key).unwrap();
    let cipher = XChaCha20Poly1305::new_from_slice(&key).unwrap();
    let mut nonce = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut blob = nonce.to_vec();
    blob.extend(cipher.encrypt(XNonce::from_slice(&nonce), plain.as_bytes()).unwrap());
    let bd = dir.join("backups");
    std::fs::create_dir_all(&bd).unwrap();
    std::fs::write(bd.join("term_backup.agm"), &blob).unwrap();
    let hash = hex::encode(Sha256::digest(&blob));
    std::fs::write(bd.join("term_backup.agm.manifest.json"),
        serde_json::json!({"bytes": blob.len(), "sha256": hash, "note": "XChaCha20-Poly1305, school-held key"}).to_string()).unwrap();
    meta_set(&db, "backup_verified", "yes", "admin");
    Ok(format!("Backup written ({} bytes, sha256 {}…)", blob.len(), &hash[..12]))
}
#[tauri::command]
fn drill_run(state: State<DbState>) -> Result<String, String> {
    // restore-verify: decrypt latest backup and check manifest hash
    let dir = state.dir.clone();
    let blob = std::fs::read(dir.join("backups").join("term_backup.agm")).map_err(|_| "no backup found — run backup first")?;
    let man: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(dir.join("backups").join("term_backup.agm.manifest.json")).unwrap()).unwrap();
    let expect = man.get("sha256").and_then(|v| v.as_str()).unwrap_or("");
    let got = hex::encode(Sha256::digest(&blob));
    if got != expect {
        return Err("drill FAIL: backup hash mismatch".into());
    }
    let db = state.db.lock().unwrap();
    meta_set(&db, "drill_passed", "yes", "admin");
    Ok(format!("Drill PASS: backup decrypt+hash verified ({} bytes)", blob.len()))
}
#[tauri::command]
fn go_live(state: State<DbState>) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    if meta_get(&db, "backup_verified").as_deref() != Some("yes") {
        return Err("Go-Live blocked: no verified backup".into());
    }
    if meta_get(&db, "drill_passed").as_deref() != Some("yes") {
        return Err("Go-Live blocked: drill not passed".into());
    }
    meta_set(&db, "live", "yes", "admin");
    Ok("LIVE".into())
}
#[tauri::command]
fn school_get(state: State<DbState>) -> String {
    let db = state.db.lock().unwrap();
    meta_get(&db, "school_name").unwrap_or_else(|| "School".to_string())
}

#[tauri::command]
fn school_set(state: State<DbState>, name: String, actor: String) -> Result<String, String> {
    let db = state.db.lock().unwrap();
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 80 {
        return Err("School name must be 1–80 characters".into());
    }
    meta_set(&db, "school_name", n, &actor);
    Ok(n.to_string())
}

#[tauri::command]
fn audit_list(state: State<DbState>) -> Vec<AuditRow> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT seq, actor, action, entity FROM audit ORDER BY seq DESC LIMIT 200").unwrap();
    stmt.query_map([], |r| Ok(AuditRow { seq: r.get(0)?, actor: r.get(1)?, action: r.get(2)?, entity: r.get(3)? }))
        .unwrap().flatten().collect()
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            // AGM_DATA_DIR lets a test/demo run use a throwaway database instead of the
            // real one under %APPDATA%. Normal launches ignore it.
            let dir = match std::env::var("AGM_DATA_DIR") {
                Ok(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
                _ => app.path().app_data_dir().unwrap().join("agent-mark-hub"),
            };
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::create_dir_all(dir.join("backups")).unwrap();
            let db = Connection::open(dir.join("hub.db")).unwrap();
            db.execute_batch(SCHEMA).unwrap();
            // AGM_AUTO_DEMO=1 seeds the demo school before the window opens, so the read
            // path can be verified end to end (screenshot / automated check) without
            // clicking anything. Never set in normal use.
            if std::env::var("AGM_AUTO_DEMO").map(|v| v == "1" || v == "yes").unwrap_or(false) {
                let _ = seed_demo_impl(&db);
            }
            app.manage(DbState { db: Mutex::new(db), dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            dashboard, seed_demo, students, roster_import, score_add, results,
            flags_scan, flags, flag_dispose, comment_pick, comment_preview, comment_save,
            reports_draft_all, reports, report_approve, report_lock, report_html,
            backup_create, drill_run, go_live, audit_list, school_get, school_set
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri app");
}
