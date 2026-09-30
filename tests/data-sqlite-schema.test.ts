import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { COLLECTIONS } from "@/lib/db/store";
import {
  BUSY_TIMEOUT_MS,
  HOT_KEYS,
  SCHEMA_VERSION,
  assertCollectionName,
  getMeta,
  isBusyError,
  isInitialized,
  listCollectionTables,
  loadSqlite,
  migrate,
  openDatabase,
  rawDataFromJson,
  rawDataToJson,
  readMeta,
  resolveStorageConfig,
  setMeta,
  transaction,
  type SqliteConnection,
} from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite items 1–2: connection pragmas, the versioned migration runner
 * (a table per collection, settings + meta tables), hot-key expression
 * indexes, driver configuration and the ExperimentalWarning filter.
 */

let dir: string;
const open: SqliteConnection[] = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-schema-"));
});

after(() => {
  for (const conn of open) if (conn.isOpen) conn.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function freshFile(): string {
  counter++;
  return path.join(dir, `case-${counter}`, "lms.sqlite");
}

function connect(file = freshFile()): SqliteConnection {
  const conn = openDatabase(file);
  open.push(conn);
  return conn;
}

function pragma(conn: SqliteConnection, name: string): unknown {
  const row = conn.prepare(`PRAGMA ${name}`).get();
  return row ? Object.values(row)[0] : undefined;
}

function indexNames(conn: SqliteConnection, tableName: string): string[] {
  return conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name LIKE 'ix_%' ORDER BY name")
    .all(tableName)
    .map((row) => String(row.name));
}

describe("openDatabase", () => {
  it("creates the folder and applies WAL, synchronous=NORMAL and the busy timeout", () => {
    const file = freshFile();
    const conn = connect(file);
    assert.ok(fs.existsSync(file));
    assert.equal(String(pragma(conn, "journal_mode")).toLowerCase(), "wal");
    assert.equal(Number(pragma(conn, "synchronous")), 1);
    assert.equal(Number(pragma(conn, "busy_timeout")), BUSY_TIMEOUT_MS);
    assert.equal(BUSY_TIMEOUT_MS, 5000);
  });

  it("opens read-only connections without creating files", () => {
    const missing = path.join(dir, "missing", "none.sqlite");
    assert.throws(() => openDatabase(missing, { readOnly: true }), /not found/);
    assert.equal(fs.existsSync(path.dirname(missing)), false);
  });
});

describe("migrate", () => {
  it("creates settings, meta and one table per collection on a new file", () => {
    const conn = connect();
    const result = migrate(conn, COLLECTIONS);
    assert.equal(result.from, 0);
    assert.equal(result.to, SCHEMA_VERSION);
    assert.equal(result.applied.length, SCHEMA_VERSION);

    const tables = listCollectionTables(conn);
    assert.deepEqual(new Set(tables), new Set(COLLECTIONS));
    assert.equal(tables.includes("meta"), false);
    assert.equal(tables.includes("settings"), false);

    const columns = conn
      .prepare(`PRAGMA table_info("enrollments")`)
      .all()
      .map((c) => ({ name: String(c.name), type: String(c.type), notnull: Number(c.notnull), pk: Number(c.pk) }));
    assert.deepEqual(columns, [
      { name: "id", type: "TEXT", notnull: 1, pk: 1 },
      { name: "doc", type: "TEXT", notnull: 1, pk: 0 },
      { name: "updated_at", type: "TEXT", notnull: 1, pk: 0 },
    ]);

    const meta = readMeta(conn);
    assert.equal(meta.schema_version, String(SCHEMA_VERSION));
    assert.ok(!Number.isNaN(Date.parse(meta.created_at!)));
    for (let v = 1; v <= SCHEMA_VERSION; v++) assert.ok(meta[`migration_${v}`], `migration_${v} is recorded`);
    assert.equal(isInitialized(conn), false, "tables alone do not make a database initialized");
  });

  it("keeps the settings table to a single row", () => {
    const conn = connect();
    migrate(conn, ["users"]);
    conn.prepare("INSERT INTO settings (id, doc, updated_at) VALUES (1, '{}', 'now')").run();
    assert.throws(() => conn.prepare("INSERT INTO settings (id, doc, updated_at) VALUES (2, '{}', 'now')").run(), /CHECK constraint/);
    assert.equal(isInitialized(conn), true);
  });

  it("is a no-op when rerun and adds tables for collections that appear later", () => {
    const conn = connect();
    migrate(conn, ["users", "courses"]);
    const createdAt = getMeta(conn, "created_at");
    conn.prepare(`INSERT INTO "users" (id, doc, updated_at) VALUES ('u1', '{"id":"u1","email":"a@b.c"}', 'now')`).run();

    const again = migrate(conn, ["users", "courses", "brandNewThings"]);
    assert.deepEqual(again, { from: SCHEMA_VERSION, to: SCHEMA_VERSION, applied: [] });
    assert.deepEqual(new Set(listCollectionTables(conn)), new Set(["users", "courses", "brandNewThings"]));
    assert.equal(getMeta(conn, "created_at"), createdAt);
    assert.equal(Number(conn.prepare(`SELECT count(*) AS n FROM "users"`).get()?.n), 1, "existing rows are kept");
  });

  it("upgrades an older schema and adds the hot-key indexes to existing tables", () => {
    const conn = connect();
    // A version-1 file: tables without expression indexes.
    conn.exec("CREATE TABLE meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
    conn.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, updated_at TEXT NOT NULL)");
    conn.exec(`CREATE TABLE "progress" (id TEXT PRIMARY KEY NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    setMeta(conn, "schema_version", "1");
    assert.deepEqual(indexNames(conn, "progress"), []);

    const result = migrate(conn, ["progress"]);
    assert.equal(result.from, 1);
    assert.equal(result.applied.length, SCHEMA_VERSION - 1);
    assert.deepEqual(indexNames(conn, "progress"), ["ix_progress_courseId", "ix_progress_lessonId", "ix_progress_userId"]);
  });

  it("refuses a database written by a newer version of the app", () => {
    const conn = connect();
    migrate(conn, ["users"]);
    setMeta(conn, "schema_version", String(SCHEMA_VERSION + 1));
    assert.throws(() => migrate(conn, ["users"]), /schema version .* only understands version/);
  });
});

describe("hot-key indexes", () => {
  it("only names real collections", () => {
    const known = new Set<string>(COLLECTIONS);
    for (const name of Object.keys(HOT_KEYS)) assert.ok(known.has(name), `HOT_KEYS.${name} is a collection`);
  });

  it("indexes the brief's hot keys on the core collections", () => {
    assert.deepEqual(HOT_KEYS.users, ["email"]);
    assert.deepEqual(HOT_KEYS.courses, ["slug"]);
    assert.ok(HOT_KEYS.enrollments?.includes("userId") && HOT_KEYS.enrollments.includes("courseId"));
    assert.ok(HOT_KEYS.progress?.includes("lessonId"));
  });

  it("creates every index and SQLite uses it for json_extract lookups", () => {
    const conn = connect();
    migrate(conn, COLLECTIONS);
    for (const [name, keys] of Object.entries(HOT_KEYS)) {
      assert.deepEqual(indexNames(conn, name), keys.map((key) => `ix_${name}_${key}`).sort(), `indexes of ${name}`);
    }
    const insert = conn.prepare(`INSERT INTO "enrollments" (id, doc, updated_at) VALUES (?, ?, 'now')`);
    for (let i = 0; i < 50; i++) insert.run(`e${i}`, JSON.stringify({ id: `e${i}`, userId: `u${i % 5}`, courseId: `c${i % 7}` }));
    const plan = conn
      .prepare("EXPLAIN QUERY PLAN SELECT doc FROM enrollments WHERE json_extract(doc, '$.userId') = ?")
      .all("u1")
      .map((row) => String(row.detail))
      .join(" | ");
    assert.match(plan, /USING INDEX ix_enrollments_userId/);
    const hits = conn.prepare("SELECT count(*) AS n FROM enrollments WHERE json_extract(doc, '$.userId') = ?").get("u1");
    assert.equal(Number(hits?.n), 10);
  });
});

describe("collection names", () => {
  it("accepts identifiers and rejects reserved or unsafe names", () => {
    for (const ok of ["users", "quizSubmissions", "a_b2"]) assert.doesNotThrow(() => assertCollectionName(ok));
    for (const bad of ["", "meta", "Settings", "sqlite_master", "2fast", "a-b", 'x"; DROP TABLE users; --', "a".repeat(64)]) {
      assert.throws(() => assertCollectionName(bad), /cannot be used as a collection name/, bad);
    }
  });
});

describe("transactions and locking", () => {
  it("rolls back everything when the callback throws", () => {
    const conn = connect();
    migrate(conn, ["users"]);
    assert.throws(
      () =>
        transaction(conn, () => {
          conn.prepare(`INSERT INTO "users" (id, doc, updated_at) VALUES ('u1', '{}', 'now')`).run();
          throw new Error("boom");
        }),
      /boom/,
    );
    assert.equal(conn.isTransaction, false);
    assert.equal(Number(conn.prepare(`SELECT count(*) AS n FROM "users"`).get()?.n), 0);
  });

  it("recognizes SQLITE_BUSY from a second writer", () => {
    const file = freshFile();
    const writer = connect(file);
    migrate(writer, ["users"]);
    const { DatabaseSync } = loadSqlite();
    const other = new DatabaseSync(file);
    open.push(other);
    other.exec("PRAGMA busy_timeout = 0");
    writer.exec("BEGIN IMMEDIATE");
    try {
      let caught: unknown = null;
      try {
        other.exec("BEGIN IMMEDIATE");
      } catch (err) {
        caught = err;
      }
      assert.ok(caught, "the second writer is refused");
      assert.equal(isBusyError(caught), true);
    } finally {
      writer.exec("ROLLBACK");
    }
    assert.equal(isBusyError(new Error("no such table: x")), false);
    assert.equal(isBusyError(null), false);
  });
});

describe("JSON documents", () => {
  it("round-trips the db.json format, settings last", () => {
    const data = rawDataFromJson({ users: [{ id: "u1", name: "A" }], courses: [], settings: { siteName: "X" }, version: 3 });
    assert.deepEqual(data, { collections: { users: [{ id: "u1", name: "A" }], courses: [] }, settings: { siteName: "X" } });
    const text = rawDataToJson(data);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["users", "courses", "settings"]);
    assert.deepEqual(rawDataFromJson(JSON.parse(text)), data);
    assert.equal(rawDataToJson(data, false).includes("\n"), false);
  });

  it("rejects documents without an id and non-database files", () => {
    assert.throws(() => rawDataFromJson({ users: [{ id: "u1" }, { name: "no id" }] }), /"users", item 2 has no id/);
    assert.throws(() => rawDataFromJson([]), /expected a JSON object/);
    assert.throws(() => rawDataFromJson({ "bad-name": [] }), /cannot be used as a collection name/);
  });
});

describe("storage configuration", () => {
  const cwd = path.resolve("/srv/app");

  it("defaults to SQLite in storage/lms.sqlite", () => {
    const config = resolveStorageConfig({}, cwd);
    assert.equal(config.driver, "sqlite");
    assert.equal(config.sqlitePath, path.join(cwd, "storage", "lms.sqlite"));
    assert.equal(config.dataFile, path.join(cwd, "storage", "db.json"));
    assert.equal(config.backupsDir, path.join(cwd, "storage", "backups"));
  });

  it("selects the JSON driver with DB_DRIVER=json and honours custom paths", () => {
    const config = resolveStorageConfig({ DB_DRIVER: " JSON ", DATA_FILE: "data/site.json", SQLITE_PATH: "/var/lib/lms.db" }, cwd);
    assert.equal(config.driver, "json");
    assert.equal(config.dataFile, path.join(cwd, "data", "site.json"));
    assert.equal(config.sqlitePath, path.resolve(cwd, "/var/lib/lms.db"));
    assert.equal(config.backupsDir, path.join(cwd, "data", "backups"));
    assert.equal(resolveStorageConfig({ DB_DRIVER: "postgres" }, cwd).driver, "sqlite");
  });
});

describe("ExperimentalWarning filter", () => {
  it("drops only the node:sqlite warning", () => {
    const core = pathToFileURL(path.resolve("src/lib/db/sqlite-core.mjs")).href;
    const script = [
      `const { loadSqlite } = await import(${JSON.stringify(core)});`,
      "loadSqlite();",
      "process.emitWarning('another experiment', 'ExperimentalWarning');",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /SQLite is an experimental feature/);
    assert.match(result.stderr, /another experiment/);
  });
});
