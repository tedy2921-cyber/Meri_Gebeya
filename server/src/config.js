import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
/** Project root: meri-gebeya/ (config.js lives in meri-gebeya/server/src/). */
export const root = join(here, "..", "..");

export const config = {
  env: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 4000),
  host: process.env.HOST || "127.0.0.1",
  dataDir: process.env.MG_DATA_DIR || join(root, "data"),
  publicDir: join(root, "public"),
  cookieName: "mg_session",
  cartCookie: "mg_cart",
  sessionTtlMs: 1000 * 60 * 60 * 24 * 30,        // 30 days
  currency: "ETB",
  secret: process.env.MG_SECRET || "dev-only-change-me",
};

mkdirSync(config.dataDir, { recursive: true });
export const dbPath = join(config.dataDir, "meri-gebeya.db");

export const db = new DatabaseSync(dbPath);

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

/** Run a schema file (idempotent, statements separated by semicolons at line ends). */
export function migrate(file = join(here, "..", "..", "db", "schema.sql")) {
  db.exec(readFileSync(file, "utf8"));
}

/** node:sqlite only accepts null/number/bigint/string/Uint8Array — this shims the rest. */
const p = (args) => args.map((v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v));

/** Transaction helper: tx(() => { ... }) rolls back on any throw. */
export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
    throw err;
  }
}

export const all = (sql, ...params) => db.prepare(sql).all(...p(params));
export const get = (sql, ...params) => db.prepare(sql).get(...p(params));
export const run = (sql, ...params) => db.prepare(sql).run(...p(params));

export const nowIso = () => new Date().toISOString();

export function setting(key, fallback = null) {
  const row = get("SELECT value FROM settings WHERE key = ?", key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key, JSON.stringify(value)
  );
}

export function logEvent(type, { productId = null, userId = null, payload = null } = {}) {
  run(
    `INSERT INTO events (type, product_id, user_id, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    type, productId, userId, payload ? JSON.stringify(payload) : null, nowIso()
  );
}
