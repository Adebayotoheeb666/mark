#!/usr/bin/env node
/* Generate a deterministic mobile-transfer fixture for the Rust cross-implementation test.
 * The bytes are encrypted with the same PBKDF2-SHA-256 + AES-256-GCM format as the PWA.
 * Demo data only; never put real student data in this file. */
const { webcrypto } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PASS = "Transfer-Passphrase-2026!";
const MAGIC = Buffer.from("AGMMOB01", "ascii");
const AAD = Buffer.from("AGM-MOBILE-TRANSFER-V1", "ascii");
const SALT = Buffer.alloc(16, 7);
const IV = Buffer.alloc(12, 9);
const ITER = 310000;

(async () => {
  const base = await webcrypto.subtle.importKey(
    "raw",
    Buffer.from(PASS, "utf8"),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await webcrypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: ITER, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const payload = {
    version: 2,
    exported_at: "2026-01-01T00:00:00.000Z",
    school_name: "Fixture Secondary School",
    term: "2026-T1",
    data_mode: "real",
    students: [{ code: "26-JSS2A-001", name: "Ada Demo", cls: "JSS 2A" }],
    scores: {
      "26-JSS2A-001|MATHS|CA1": { v: 17, at: "2026-01-01T00:00:00.000Z" },
      "26-JSS2A-001|MATHS|CA2": { v: 18, at: "2026-01-01T00:00:00.000Z" },
      "26-JSS2A-001|MATHS|Exam": { v: 51, at: "2026-01-01T00:00:00.000Z" },
      "26-JSS2A-001|ENG|CA": { v: 33, at: "2026-01-01T00:00:00.000Z" },
      "26-JSS2A-001|ENG|Exam": { v: 49, at: "2026-01-01T00:00:00.000Z" }
    }
  };
  const ct = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: IV, additionalData: AAD, tagLength: 128 },
    key,
    Buffer.from(JSON.stringify(payload), "utf8")
  );
  const file = Buffer.concat([MAGIC, SALT, IV, Buffer.from(ct)]);
  const out = path.resolve(__dirname, "..", "src-tauri", "tests", "fixtures", "mobile-export.agmm");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, file);
  console.log(`${out} (${file.length} bytes)`);
})();
