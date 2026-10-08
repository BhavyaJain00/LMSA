/**
 * Reads the database of an older version of the app, for
 * `npm run db:to-postgres` only: a SQLite database (`storage/lms.sqlite`, or
 * one of its `.sqlite` backups) or a JSON export (`storage/db.json`,
 * `db.json.migrated-*`, a downloaded backup). The app itself has no SQLite
 * code any more; `node:sqlite` (built into Node 22.5+) is used here and
 * nowhere else.
 *
 * Layout of those SQLite files: one table per collection
 * `(id TEXT PRIMARY KEY, doc TEXT, updated_at TEXT)` whose rowid keeps the
 * array order, a single-row `settings` table and a `meta` table. The source
 * is opened read-only and never changed.
 */
import fs from "node:fs";
import { assertCollectionName, readJsonFile } from "../../src/lib/db/data-core.mjs";

/** @typedef {import("../../src/lib/db/data-core.mjs").RawData} RawData */

const SQLITE_MAGIC = "SQLite format 3\u0000";
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;
const NOT_COLLECTIONS = new Set(["meta", "settings"]);

/** "sqlite", "json", or null for anything else. */
export function detectSourceFormat(/** @type {string} */ file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(64);
    const head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0));
    if (head.subarray(0, 16).toString("latin1") === SQLITE_MAGIC) return "sqlite";
    if (head.toString("utf8").replace(/^﻿/, "").trimStart().startsWith("{")) return "json";
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Load `node:sqlite` without its "SQLite is an experimental feature" warning (other warnings still print). */
async function loadSqlite() {
  const emitWarning = process.emitWarning;
  process.emitWarning = /** @type {typeof process.emitWarning} */ (
    function (/** @type {string | Error} */ warning, /** @type {unknown[]} */ ...rest) {
      const message = typeof warning === "string" ? warning : warning?.message ?? "";
      if (/\bSQLite\b/.test(message)) return;
      return /** @type {(...args: unknown[]) => void} */ (emitWarning).call(process, warning, ...rest);
    }
  );
  try {
    return await import("node:sqlite");
  } catch (err) {
    throw new Error(`Reading a SQLite file needs Node.js 22.5 or newer (node:sqlite): ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * Read a SQLite database made by an older version of the app.
 * @param {string} file
 * @returns {Promise<RawData>}
 */
export async function readSqliteDatabase(file) {
  const { DatabaseSync } = await loadSqlite();
  // A copy of a WAL-mode database makes even a read-only connection create -wal/-shm files; remove those it created.
  const created = ["-wal", "-shm"].filter((suffix) => !fs.existsSync(file + suffix));
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = /** @type {{ name: string }[]} */ (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid").all()).map((row) => String(row.name));
    if (!tables.includes("meta") || !tables.includes("settings")) throw new Error("This SQLite file was not created by this app (it has no meta/settings tables).");
    /** @type {Record<string, unknown[]>} */
    const collections = {};
    for (const name of tables) {
      if (NOT_COLLECTIONS.has(name) || name.startsWith("sqlite_") || !IDENTIFIER.test(name)) continue;
      assertCollectionName(name);
      const rows = /** @type {{ id: unknown; doc: unknown }[]} */ (db.prepare(`SELECT id, doc FROM "${name}" ORDER BY rowid`).all());
      collections[name] = rows.map((row) => {
        try {
          return JSON.parse(String(row.doc));
        } catch {
          throw new Error(`Collection "${name}" has a damaged document (id ${String(row.id)}): it is not valid JSON.`);
        }
      });
    }
    const settingsRow = /** @type {{ doc: unknown } | undefined} */ (db.prepare("SELECT doc FROM settings WHERE id = 1").get());
    let settings = null;
    if (settingsRow) {
      try {
        settings = JSON.parse(String(settingsRow.doc));
      } catch {
        throw new Error("The settings row is damaged: it is not valid JSON.");
      }
    }
    return { collections, settings };
  } finally {
    db.close();
    for (const suffix of created) fs.rmSync(file + suffix, { force: true });
  }
}

/**
 * Read an old database: a SQLite file or a JSON export.
 * @param {string} file
 * @returns {Promise<{ format: "sqlite" | "json"; data: RawData }>}
 */
export async function readSourceDatabase(file) {
  const format = detectSourceFormat(file);
  if (format === "sqlite") return { format, data: await readSqliteDatabase(file) };
  if (format === "json") return { format, data: readJsonFile(file) };
  throw new Error("This is neither a SQLite database nor a JSON export made by this app.");
}
