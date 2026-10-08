import fs from "node:fs";
import path from "node:path";
import type { RawData } from "@/lib/db/driver";

/** The part of `node:sqlite` the tests use (@types/node 20 has no types for it). */
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

/** Open (and create) a SQLite file with Node's built-in driver. */
export async function openSqlite(file: string): Promise<SqliteDatabase> {
  const emitWarning = process.emitWarning;
  // Loading node:sqlite prints an ExperimentalWarning once; keep test output clean.
  process.emitWarning = (() => undefined) as typeof process.emitWarning;
  try {
    const specifier = "node:sqlite";
    const sqlite = (await import(specifier)) as { DatabaseSync: new (file: string) => SqliteDatabase };
    return new sqlite.DatabaseSync(file);
  } finally {
    process.emitWarning = emitWarning;
  }
}

/**
 * Builds a SQLite database the way older versions of the app stored their
 * data (`storage/lms.sqlite`), so tests can check that
 * `npm run db:to-postgres` reads one. Uses Node's built-in `node:sqlite`
 * (tests and that script only; the app has no SQLite code).
 */
export async function createLegacySqlite(file: string, data: RawData, options: { wal?: boolean } = {}): Promise<void> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = await openSqlite(file);
  try {
    if (options.wal) db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '2')").run();
    const now = new Date().toISOString();
    for (const [name, docs] of Object.entries(data.collections)) {
      db.exec(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      const insert = db.prepare(`INSERT INTO "${name}" (id, doc, updated_at) VALUES (?, ?, ?)`);
      for (const doc of docs) insert.run((doc as { id: string }).id, JSON.stringify(doc), now);
    }
    if (data.settings) db.prepare("INSERT INTO settings (id, doc, updated_at) VALUES (1, ?, ?)").run(JSON.stringify(data.settings), now);
  } finally {
    db.close();
  }
}
