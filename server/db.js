// db.js — serverseitige Persistenz mit Node's eingebautem SQLite (node:sqlite).
// Speichert NUR Ciphertext + Metadaten. Der Decryption-Key (im #-Fragment) und
// das Datei-Passwort erreichen den Server nie -> Zero-Knowledge bleibt erhalten.
//
// Diese Datei kapselt sämtlichen DB-Zugriff. Beim Umstieg auf Supabase/Postgres
// wird nur dieses Modul ersetzt; die Express-Routen bleiben unverändert.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(__dirname, "..", "data");
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, "encryo.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    salt TEXT NOT NULL,
    hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS links (
    id TEXT PRIMARY KEY,
    owner_id TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    one_time INTEGER NOT NULL DEFAULT 0,
    burned INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER NOT NULL DEFAULT 0,
    password_protected INTEGER NOT NULL DEFAULT 0,
    salt TEXT,
    verifier_iv TEXT,
    verifier_ct TEXT
  );
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    pos INTEGER NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    mimetype TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS accesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    FOREIGN KEY (link_id) REFERENCES links(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_links_owner ON links(owner_id);
  CREATE INDEX IF NOT EXISTS idx_files_link ON files(link_id);
  CREATE INDEX IF NOT EXISTS idx_accesses_link ON accesses(link_id);
`);

// --- Migrationen -----------------------------------------------------------
// CREATE TABLE IF NOT EXISTS ändert bestehende Tabellen nicht. Neue Spalten
// werden daher additiv per ALTER TABLE nachgezogen (nur falls noch nicht da).
function ensureColumn(table, col, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === col))
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`);
}
// Account-Recovery: pro-User-Salt, aus dem der Client den Wrapping-Key ableitet.
ensureColumn("users", "recovery_salt", "TEXT");
// Kill-Switch + Max-Views.
ensureColumn("links", "max_views", "INTEGER");
ensureColumn("links", "revoked", "INTEGER NOT NULL DEFAULT 0");
// Recovery-Vault: mit dem Account-Passwort verschlüsselte Kopie des Link-Secrets.
ensureColumn("links", "recovery_iv", "TEXT");
ensureColumn("links", "recovery_ct", "TEXT");

// --- IDs & Hashing ---------------------------------------------------------
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function shortId(len = 10) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
function uuid() {
  return crypto.randomUUID();
}
function token() {
  return crypto.randomBytes(32).toString("hex");
}
function hashPw(password, saltHex) {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64).toString("hex");
}
// base64url ohne Padding — passt zum Client (bufToB64url / b64urlToBuf in crypto.js).
function recoverySalt() {
  return crypto.randomBytes(16).toString("base64url");
}

// --- Users & Sessions ------------------------------------------------------
export function createUser(username, password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPw(password, salt);
  const id = uuid();
  const recSalt = recoverySalt();
  db.prepare(
    "INSERT INTO users(id, username, salt, hash, created_at, recovery_salt) VALUES(?,?,?,?,?,?)"
  ).run(id, username, salt, hash, Date.now(), recSalt);
  return { id, username, recoverySalt: recSalt };
}

export function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username);
}

// Backfill für Altaccounts (vor der Recovery-Migration angelegt). Stabil danach:
// das Salt darf sich nicht mehr ändern, sonst werden bestehende Vaults unbrauchbar.
export function ensureRecoverySalt(userId) {
  const u = db.prepare("SELECT recovery_salt FROM users WHERE id = ?").get(userId);
  if (u && !u.recovery_salt) {
    const recSalt = recoverySalt();
    db.prepare("UPDATE users SET recovery_salt = ? WHERE id = ?").run(recSalt, userId);
    return recSalt;
  }
  return u ? u.recovery_salt : null;
}

export function verifyUser(username, password) {
  const u = getUserByUsername(username);
  if (!u) return null;
  const candidate = hashPw(password, u.salt);
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(u.hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { id: u.id, username: u.username, recoverySalt: ensureRecoverySalt(u.id) };
}

// Ändert das Account-Passwort (neuer scrypt-Hash + neues Salt). Das recovery_salt
// bleibt stabil — der Client re-wrappt die Vaults mit dem neuen Passwort separat.
export function changePassword(userId, newPassword) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPw(newPassword, salt);
  db.prepare("UPDATE users SET salt = ?, hash = ? WHERE id = ?").run(salt, hash, userId);
}

export function createSession(userId) {
  const t = token();
  db.prepare("INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)").run(
    t,
    userId,
    Date.now()
  );
  return t;
}

export function getSessionUser(tok) {
  if (!tok) return null;
  const row = db
    .prepare(
      "SELECT u.id, u.username, u.recovery_salt AS recoverySalt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"
    )
    .get(tok);
  return row || null;
}

export function deleteSession(tok) {
  if (tok) db.prepare("DELETE FROM sessions WHERE token = ?").run(tok);
}

// --- Links -----------------------------------------------------------------
const isExpired = (l) => l.expires_at != null && Date.now() > l.expires_at;

export function createLink({
  files,
  salt,
  verifier,
  oneTime,
  expiresInHours,
  passwordProtected,
  ownerId,
  maxViews,
  recovery,
}) {
  const id = shortId();
  const now = Date.now();
  const expiresAt = expiresInHours ? now + expiresInHours * 3600_000 : null;
  // Recovery-Vault nur für eingeloggte Owner (sonst gäbe es keinen Account, an
  // den das verschlüsselte Secret gebunden ist).
  const rec = ownerId && recovery ? recovery : null;
  const maxV = Number.isInteger(maxViews) && maxViews > 0 ? maxViews : null;

  try {
    db.exec("BEGIN");
    db.prepare(
      `INSERT INTO links(id, owner_id, created_at, expires_at, one_time, burned,
        view_count, password_protected, salt, verifier_iv, verifier_ct,
        max_views, recovery_iv, recovery_ct)
       VALUES(?,?,?,?,?,0,0,?,?,?,?,?,?,?)`
    ).run(
      id,
      ownerId || null,
      now,
      expiresAt,
      oneTime ? 1 : 0,
      passwordProtected ? 1 : 0,
      salt || null,
      verifier?.iv || null,
      verifier?.ciphertext || null,
      maxV,
      rec?.iv || null,
      rec?.ciphertext || null
    );
    const ins = db.prepare(
      "INSERT INTO files(link_id, pos, filename, size, mimetype, iv, ciphertext) VALUES(?,?,?,?,?,?,?)"
    );
    files.forEach((f, i) =>
      ins.run(id, i, f.filename, f.size, f.mimetype, f.iv, f.ciphertext)
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { id };
}

function linkRow(id) {
  return db.prepare("SELECT * FROM links WHERE id = ?").get(id);
}

export function getLinkMeta(id) {
  const l = linkRow(id);
  if (!l) return { found: false };
  const agg = db
    .prepare("SELECT COUNT(*) c, COALESCE(SUM(size),0) s FROM files WHERE link_id = ?")
    .get(id);
  return {
    found: true,
    id: l.id,
    createdAt: l.created_at,
    expiresAt: l.expires_at,
    oneTime: !!l.one_time,
    burned: !!l.burned,
    viewCount: l.view_count,
    passwordProtected: !!l.password_protected,
    salt: l.salt,
    verifier: l.verifier_ct ? { iv: l.verifier_iv, ciphertext: l.verifier_ct } : null,
    fileCount: agg.c,
    totalSize: agg.s,
    expired: isExpired(l),
    revoked: !!l.revoked,
    maxViews: l.max_views,
    // Verrät nur, DASS ein (verschlüsselter) Recovery-Vault existiert — nicht den Inhalt.
    recoverable: !!l.recovery_ct,
  };
}

// Atomar: erhöht view_count, brennt bei One-Time. WHERE burned=0 verhindert,
// dass zwei parallele Aufrufe denselben One-Time-Link beide öffnen.
export function openLink(id) {
  const exists = linkRow(id);
  if (!exists) return { ok: false, reason: "NOT_FOUND" };

  const now = Date.now();
  // Atomar wie bei One-Time: WHERE schließt schon verbrauchte/limitierte Links aus,
  // CASE verbrennt One-Time UND Links, die mit dieser Öffnung ihr Max-Views erreichen.
  const upd = db
    .prepare(
      `UPDATE links
         SET view_count = view_count + 1,
             burned = CASE
               WHEN one_time = 1
                 OR (max_views IS NOT NULL AND view_count + 1 >= max_views)
               THEN 1 ELSE burned END
       WHERE id = ? AND burned = 0 AND (expires_at IS NULL OR expires_at > ?)
         AND (max_views IS NULL OR view_count < max_views)`
    )
    .run(id, now);

  if (upd.changes === 0) {
    const l = linkRow(id);
    if (l.revoked) return { ok: false, reason: "REVOKED" };
    if (l.burned) return { ok: false, reason: "BURNED" };
    if (isExpired(l)) return { ok: false, reason: "EXPIRED" };
    return { ok: false, reason: "NOT_FOUND" };
  }

  db.prepare("INSERT INTO accesses(link_id, ts) VALUES(?,?)").run(id, now);
  const files = db
    .prepare("SELECT filename, size, mimetype, iv, ciphertext FROM files WHERE link_id = ? ORDER BY pos")
    .all(id);
  const l = linkRow(id);
  return { ok: true, files, meta: { viewCount: l.view_count, oneTime: !!l.one_time } };
}

export function deleteLink(id, ownerId) {
  const l = linkRow(id);
  if (!l) return { ok: false, reason: "NOT_FOUND" };
  if (l.owner_id !== ownerId) return { ok: false, reason: "FORBIDDEN" };
  db.prepare("DELETE FROM links WHERE id = ?").run(id);
  return { ok: true };
}

// Kill-Switch: Link sofort & unwiderruflich sperren (nur Owner).
export function revokeLink(id, ownerId) {
  const l = linkRow(id);
  if (!l) return { ok: false, reason: "NOT_FOUND" };
  if (l.owner_id !== ownerId) return { ok: false, reason: "FORBIDDEN" };
  db.prepare("UPDATE links SET revoked = 1, burned = 1 WHERE id = ?").run(id);
  return { ok: true };
}

// Verschlüsselter Recovery-Vault eines Links — nur an den Owner herausgeben.
export function getLinkRecovery(id, ownerId) {
  const l = linkRow(id);
  if (!l) return { ok: false, reason: "NOT_FOUND" };
  if (l.owner_id !== ownerId) return { ok: false, reason: "FORBIDDEN" };
  if (!l.recovery_ct) return { ok: false, reason: "NO_RECOVERY" };
  return { ok: true, recovery: { iv: l.recovery_iv, ciphertext: l.recovery_ct } };
}

// Re-Wrap nach Account-Passwort-Wechsel: ersetzt die Vault-Blobs der eigenen
// Links durch die clientseitig neu verschlüsselten. Items fremder Links werden
// ignoriert (WHERE owner_id), der Klartext erreicht den Server nie.
export function rewrapRecovery(ownerId, items) {
  if (!Array.isArray(items) || items.length === 0) return { updated: 0 };
  const upd = db.prepare(
    "UPDATE links SET recovery_iv = ?, recovery_ct = ? WHERE id = ? AND owner_id = ?"
  );
  let updated = 0;
  try {
    db.exec("BEGIN");
    for (const it of items) {
      if (!it || !it.id || !it.iv || !it.ciphertext) continue;
      updated += upd.run(it.iv, it.ciphertext, it.id, ownerId).changes;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return { updated };
}

export function listLinksByOwner(ownerId) {
  const rows = db
    .prepare("SELECT * FROM links WHERE owner_id = ? ORDER BY created_at DESC")
    .all(ownerId);
  return rows.map((l) => {
    const files = db
      .prepare("SELECT filename FROM files WHERE link_id = ? ORDER BY pos")
      .all(l.id);
    const log = db
      .prepare("SELECT ts FROM accesses WHERE link_id = ? ORDER BY ts")
      .all(l.id)
      .map((r) => r.ts);
    return {
      id: l.id,
      createdAt: l.created_at,
      expiresAt: l.expires_at,
      oneTime: !!l.one_time,
      burned: !!l.burned,
      revoked: !!l.revoked,
      viewCount: l.view_count,
      maxViews: l.max_views,
      passwordProtected: !!l.password_protected,
      recoverable: !!l.recovery_ct,
      // Owner-only Endpoint -> der (verschlüsselte) Vault darf hier mitkommen,
      // damit das Dashboard den Voll-Link ohne extra Roundtrip rekonstruieren kann.
      recovery: l.recovery_ct ? { iv: l.recovery_iv, ciphertext: l.recovery_ct } : null,
      filenames: files.map((f) => f.filename),
      accessLog: log,
      exists: true,
      expired: isExpired(l),
    };
  });
}
