/**
 * SQLite storage primitives shared by the app's store driver
 * (`src/lib/db/sqlite.ts`) and the offline CLI scripts (`scripts/db-*.mjs`).
 *
 * Plain JavaScript typed with JSDoc so `node scripts/db-backup.mjs` can
 * import it without a build step. Node built-ins only (`node:sqlite`,
 * `node:fs`, `node:path`).
 *
 * Layout of a database file:
 *  - one table per collection: `(id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`,
 *    where `doc` is the JSON document and the rowid keeps the array order
 *    (insertion order, renumbered when the array is reordered);
 *  - `settings`: a single row (`id = 1`) holding the settings JSON;
 *  - `meta`: key/value pairs (`schema_version`, `created_at`, `initialized_at`, …).
 */
import fs from "node:fs";
import path from "node:path";

/** @typedef {string | number | bigint | null | Uint8Array} SqlValue */
/** @typedef {Record<string, SqlValue>} SqlRow */
/**
 * @typedef {object} SqliteStatement
 * @property {(...params: SqlValue[]) => { changes: number | bigint; lastInsertRowid: number | bigint }} run
 * @property {(...params: SqlValue[]) => SqlRow | undefined} get
 * @property {(...params: SqlValue[]) => SqlRow[]} all
 */
/**
 * @typedef {object} SqliteConnection
 * @property {(sql: string) => void} exec
 * @property {(sql: string) => SqliteStatement} prepare
 * @property {() => void} close
 * @property {boolean} isOpen
 * @property {boolean} isTransaction
 */
/**
 * Database contents independent of the storage engine.
 * @typedef {object} RawData
 * @property {Record<string, unknown[]>} collections
 * @property {unknown} settings  Settings object, or null when the source had none.
 */
/**
 * @typedef {object} CollectionChanges
 * @property {string} name
 * @property {{ id: string; json: string }[]} upserts
 * @property {string[]} deletes
 * @property {string[]} [order]  Every id in array order, when the array was reordered: rows are renumbered to match.
 */
/**
 * @typedef {object} ChangeSet
 * @property {CollectionChanges[]} collections
 * @property {string | null} settings  Settings JSON when they changed.
 */

/** Current schema version (see MIGRATIONS). */
export const SCHEMA_VERSION = 2;

/** How long a connection waits for another writer before failing with SQLITE_BUSY. */
export const BUSY_TIMEOUT_MS = 5000;

/** Table names that are not collections. */
const RESERVED_TABLES = new Set(["meta", "settings"]);

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

/**
 * JSON keys that are looked up constantly, per collection. Each gets an
 * expression index (`json_extract(doc, '$.key')`) so SQL-level lookups
 * (scripts, reports, future queries) do not scan whole tables.
 * Collections missing here simply have no extra index.
 */
export const HOT_KEYS = /** @type {Readonly<Record<string, readonly string[]>>} */ ({
  users: ["email"],
  sessions: ["userId"],
  categories: ["slug"],
  courses: ["slug"],
  chapters: ["courseId"],
  lessons: ["courseId", "slug"],
  quizzes: ["courseId", "lessonId"],
  quizSubmissions: ["userId", "courseId", "lessonId"],
  quizViolations: ["userId"],
  assignments: ["courseId"],
  assignmentSubmissions: ["userId", "courseId", "lessonId"],
  exercises: ["courseId"],
  exerciseSubmissions: ["userId", "courseId", "lessonId"],
  enrollments: ["userId", "courseId"],
  progress: ["userId", "courseId", "lessonId"],
  videoWatches: ["userId", "courseId", "lessonId"],
  notes: ["userId", "courseId", "lessonId"],
  reviews: ["userId", "courseId"],
  batches: ["slug"],
  batchEnrollments: ["userId"],
  batchFeedback: ["userId"],
  announcements: ["courseId"],
  programs: ["slug"],
  programMembers: ["userId"],
  certificates: ["userId", "courseId"],
  certificateRequests: ["userId", "courseId"],
  certificateEvaluations: ["userId", "courseId"],
  badgeAssignments: ["userId"],
  activities: ["userId"],
  notifications: ["userId"],
  discussionTopics: ["courseId"],
  payments: ["userId"],
  jobs: ["slug"],
  jobApplications: ["userId"],
  emails: ["userId"],
  authTokens: ["userId"],
  loginEvents: ["userId", "email"],
  points: ["userId", "courseId"],
  uploadSessions: ["userId"],
  transcodeJobs: ["lessonId"],
  transcripts: ["lessonId"],
  blogPosts: ["slug"],
  leads: ["courseId", "email"],
  legalPages: ["slug"],
  consents: ["userId"],
  errorEvents: ["userId"],
  dataRequests: ["userId"],
  aiConversations: ["userId", "courseId", "lessonId"],
  plans: ["slug"],
  subscriptions: ["userId"],
  bundles: ["slug"],
  checkoutSessions: ["userId", "email"],
  affiliates: ["userId"],
  organizations: ["slug"],
  orgSeats: ["userId", "email"],
  analyticsEvents: ["userId"],
  emailSequences: ["courseId"],
  sequenceEnrollments: ["userId", "email"],
  conversations: ["courseId"],
  lessonVersions: ["lessonId"],
  instructorProfiles: ["userId"],
  earnings: ["courseId"],
});

/* ------------------------------------------------------------------ */
/* Loading node:sqlite                                                 */
/* ------------------------------------------------------------------ */

/** @type {{ DatabaseSync: new (file: string, options?: Record<string, unknown>) => SqliteConnection } | null} */
let sqliteModule = null;

/**
 * Load `node:sqlite`. Node prints an "SQLite is an experimental feature"
 * warning the first time the module loads; exactly that warning is dropped
 * (every other warning, including other experimental ones, still prints).
 */
export function loadSqlite() {
  if (sqliteModule) return sqliteModule;
  const original = process.emitWarning;
  /** @param {string | Error} warning @param {unknown[]} rest */
  const filtered = function (warning, ...rest) {
    const message = typeof warning === "string" ? warning : (warning?.message ?? "");
    const first = rest[0];
    const type =
      typeof first === "string" ? first : first && typeof first === "object" && "type" in first ? String(first.type) : typeof warning === "object" ? warning.name : "";
    if (type === "ExperimentalWarning" && /\bSQLite\b/.test(message)) return;
    return /** @type {(...args: unknown[]) => void} */ (original).call(process, warning, ...rest);
  };
  process.emitWarning = /** @type {typeof process.emitWarning} */ (filtered);
  try {
    const getBuiltin = /** @type {{ getBuiltinModule?: (id: string) => unknown }} */ (process).getBuiltinModule;
    if (typeof getBuiltin !== "function") {
      throw new Error(`SQLite storage needs Node.js 22.13 or newer (running ${process.version}). Upgrade Node.js or set DB_DRIVER=json.`);
    }
    sqliteModule = /** @type {NonNullable<typeof sqliteModule>} */ (getBuiltin.call(process, "node:sqlite"));
  } finally {
    process.emitWarning = original;
  }
  return sqliteModule;
}

/** @type {string | null} */
let cachedVersion = null;

/** The SQLite library version bundled with Node.js. */
export function sqliteVersion() {
  if (cachedVersion !== null) return cachedVersion;
  const { DatabaseSync } = loadSqlite();
  const conn = new DatabaseSync(":memory:");
  try {
    cachedVersion = String(conn.prepare("SELECT sqlite_version() AS v").get()?.v ?? "");
    return cachedVersion;
  } finally {
    conn.close();
  }
}

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

/**
 * Open (and create, unless `readOnly`) a database file with the pragmas the
 * store relies on: WAL journal, NORMAL sync (durable at checkpoints, safe
 * against corruption), and a busy timeout so a second process waits instead
 * of failing immediately. Read-only connections (backups, uploaded files)
 * do not trust the file's schema, so views and triggers stored in it cannot
 * reach beyond plain SQL.
 *
 * @param {string} file
 * @param {{ readOnly?: boolean; busyTimeoutMs?: number }} [options]
 * @returns {SqliteConnection}
 */
export function openDatabase(file, options = {}) {
  const { DatabaseSync } = loadSqlite();
  const readOnly = options.readOnly === true;
  const busyTimeout = Math.max(0, Math.round(options.busyTimeoutMs ?? BUSY_TIMEOUT_MS));
  if (readOnly) {
    if (!fs.existsSync(file)) throw new Error(`Database file not found: ${file}`);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const conn = new DatabaseSync(file, { readOnly });
  try {
    conn.exec(`PRAGMA busy_timeout = ${busyTimeout}`);
    if (readOnly) conn.exec("PRAGMA trusted_schema = OFF");
    if (!readOnly) {
      const mode = conn.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
      if (String(mode).toLowerCase() !== "wal") {
        console.warn(`[db] ${file}: the filesystem does not support WAL mode (using "${mode}"). Keep the database on a local disk.`);
      }
      conn.exec("PRAGMA synchronous = NORMAL");
    }
  } catch (err) {
    conn.close();
    throw err;
  }
  return conn;
}

/** True for SQLITE_BUSY / SQLITE_LOCKED errors (another connection holds the write lock). */
export function isBusyError(/** @type {unknown} */ err) {
  if (!err || typeof err !== "object") return false;
  const code = /** @type {{ errcode?: number }} */ (err).errcode;
  return code === 5 || code === 6 || /database is locked|database table is locked/i.test(String(/** @type {Error} */ (err).message));
}

/** True for SQLITE_CORRUPT / SQLITE_NOTADB errors (the file is damaged, or is not a database at all). */
export function isCorruptionError(/** @type {unknown} */ err) {
  if (!err || typeof err !== "object") return false;
  const code = /** @type {{ errcode?: number }} */ (err).errcode;
  return code === 11 || code === 26 || /database disk image is malformed|file is not a database/i.test(String(/** @type {Error} */ (err).message));
}

/**
 * Run `fn` inside `BEGIN IMMEDIATE … COMMIT` (rolled back when it throws).
 * @template T
 * @param {SqliteConnection} conn
 * @param {() => T} fn
 * @returns {T}
 */
export function transaction(conn, fn) {
  conn.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      if (conn.isTransaction) conn.exec("ROLLBACK");
    } catch {
      // The original error is what matters.
    }
    throw err;
  }
}

/** @type {WeakMap<SqliteConnection, Map<string, SqliteStatement>>} */
const statementCache = new WeakMap();

/** A cached prepared statement for `sql` on `conn`. */
function cached(/** @type {SqliteConnection} */ conn, /** @type {string} */ sql) {
  let map = statementCache.get(conn);
  if (!map) statementCache.set(conn, (map = new Map()));
  let stmt = map.get(sql);
  if (!stmt) map.set(sql, (stmt = conn.prepare(sql)));
  return stmt;
}

/** Quote a validated table name. */
function table(/** @type {string} */ name) {
  assertCollectionName(name);
  return `"${name}"`;
}

/** Throw unless `name` can be a collection table. */
export function assertCollectionName(/** @type {string} */ name) {
  if (!IDENTIFIER.test(name) || RESERVED_TABLES.has(name.toLowerCase()) || name.toLowerCase().startsWith("sqlite_")) {
    throw new Error(`"${name}" cannot be used as a collection name.`);
  }
}

/* ------------------------------------------------------------------ */
/* Integrity                                                           */
/* ------------------------------------------------------------------ */

/**
 * `PRAGMA quick_check` (or the slower, more thorough `integrity_check`).
 * @param {SqliteConnection} conn
 * @param {"quick" | "full"} [mode]
 * @returns {{ ok: boolean; messages: string[] }}
 */
export function checkIntegrity(conn, mode = "quick") {
  const rows = conn.prepare(mode === "full" ? "PRAGMA integrity_check(20)" : "PRAGMA quick_check(20)").all();
  const messages = rows.map((row) => String(Object.values(row)[0] ?? ""));
  return { ok: messages.length === 1 && messages[0] === "ok", messages };
}

/* ------------------------------------------------------------------ */
/* Meta + migrations                                                   */
/* ------------------------------------------------------------------ */

/** @returns {string | null} */
export function getMeta(/** @type {SqliteConnection} */ conn, /** @type {string} */ key) {
  const row = cached(conn, "SELECT value FROM meta WHERE key = ?").get(key);
  return row ? String(row.value) : null;
}

export function setMeta(/** @type {SqliteConnection} */ conn, /** @type {string} */ key, /** @type {string} */ value) {
  cached(conn, "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** All meta rows as an object. */
export function readMeta(/** @type {SqliteConnection} */ conn) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!tableExists(conn, "meta")) return out;
  for (const row of conn.prepare("SELECT key, value FROM meta ORDER BY key").all()) out[String(row.key)] = String(row.value);
  return out;
}

function tableExists(/** @type {SqliteConnection} */ conn, /** @type {string} */ name) {
  return Boolean(conn.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** Names of the collection tables present in the file (in creation order). */
export function listCollectionTables(/** @type {SqliteConnection} */ conn) {
  return conn
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY rowid")
    .all()
    .map((row) => String(row.name))
    .filter((name) => IDENTIFIER.test(name) && !RESERVED_TABLES.has(name.toLowerCase()) && !name.toLowerCase().startsWith("sqlite_"));
}

/** Create a collection table and its hot-key indexes when missing. */
function ensureCollectionTable(/** @type {SqliteConnection} */ conn, /** @type {string} */ name) {
  conn.exec(`CREATE TABLE IF NOT EXISTS ${table(name)} (id TEXT PRIMARY KEY NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  for (const key of HOT_KEYS[name] ?? []) {
    conn.exec(`CREATE INDEX IF NOT EXISTS "ix_${name}_${key}" ON ${table(name)} (json_extract(doc, '$.${key}'))`);
  }
}

/**
 * Versioned schema changes, applied in order inside one transaction. Never
 * edit a released step: append a new one and bump SCHEMA_VERSION.
 * Collection tables themselves are created by `migrate()` for every name it
 * is given, so adding a collection to the store needs no migration.
 *
 * @type {{ version: number; name: string; up: (conn: SqliteConnection) => void }[]}
 */
const MIGRATIONS = [
  {
    version: 1,
    name: "settings and meta tables",
    up(conn) {
      conn.exec("CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, updated_at TEXT NOT NULL)");
    },
  },
  {
    version: 2,
    name: "hot-key expression indexes",
    up(conn) {
      for (const name of listCollectionTables(conn)) ensureCollectionTable(conn, name);
    },
  },
];

/**
 * Bring a database up to SCHEMA_VERSION and make sure a table exists for
 * every collection in `collections`. Safe to run on every start.
 *
 * @param {SqliteConnection} conn
 * @param {readonly string[]} collections
 * @returns {{ from: number; to: number; applied: string[] }}
 */
export function migrate(conn, collections) {
  conn.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)");
  const from = Number(getMeta(conn, "schema_version") ?? 0) || 0;
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `This database uses schema version ${from}, but this version of the app only understands version ${SCHEMA_VERSION}. Update the app, or restore a backup made by this version.`,
    );
  }
  /** @type {string[]} */
  const applied = [];
  transaction(conn, () => {
    const now = new Date().toISOString();
    for (const step of MIGRATIONS) {
      if (step.version <= from) continue;
      step.up(conn);
      setMeta(conn, "schema_version", String(step.version));
      setMeta(conn, `migration_${step.version}`, `${now} ${step.name}`);
      applied.push(step.name);
    }
    for (const name of collections) ensureCollectionTable(conn, name);
    if (!getMeta(conn, "created_at")) setMeta(conn, "created_at", now);
  });
  return { from, to: SCHEMA_VERSION, applied };
}

/**
 * Create tables (and indexes) for collections that appeared after the
 * database was opened, in one transaction.
 * @param {SqliteConnection} conn
 * @param {readonly string[]} names
 */
export function ensureCollectionTables(conn, names) {
  if (!names.length) return;
  transaction(conn, () => {
    for (const name of names) ensureCollectionTable(conn, name);
  });
}

/** Whether the file already holds a database (imported, seeded or restored). */
export function isInitialized(/** @type {SqliteConnection} */ conn) {
  if (getMeta(conn, "initialized_at")) return true;
  return tableExists(conn, "settings") && Boolean(conn.prepare("SELECT 1 AS found FROM settings WHERE id = 1").get());
}

/* ------------------------------------------------------------------ */
/* Reading and writing                                                 */
/* ------------------------------------------------------------------ */

/**
 * Read every document. `collections` defaults to the tables in the file;
 * names without a table come back as empty arrays.
 *
 * @param {SqliteConnection} conn
 * @param {readonly string[]} [collections]
 * @returns {RawData}
 */
export function readAllData(conn, collections) {
  const present = new Set(listCollectionTables(conn));
  const names = collections ?? [...present];
  /** @type {Record<string, unknown[]>} */
  const out = {};
  for (const name of names) {
    if (!present.has(name)) {
      out[name] = [];
      continue;
    }
    const rows = conn.prepare(`SELECT id, doc FROM ${table(name)} ORDER BY rowid`).all();
    const docs = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      try {
        docs[i] = JSON.parse(String(rows[i].doc));
      } catch {
        throw new Error(`Collection "${name}" has a damaged document (id ${String(rows[i].id)}): it is not valid JSON.`);
      }
    }
    out[name] = docs;
  }
  let settings = null;
  if (tableExists(conn, "settings")) {
    const row = conn.prepare("SELECT doc FROM settings WHERE id = 1").get();
    if (row) {
      try {
        settings = JSON.parse(String(row.doc));
      } catch {
        throw new Error("The settings row is damaged: it is not valid JSON.");
      }
    }
  }
  return { collections: out, settings };
}

/** Row counts per collection table. */
export function countRows(/** @type {SqliteConnection} */ conn) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const name of listCollectionTables(conn)) {
    counts[name] = Number(conn.prepare(`SELECT count(*) AS n FROM ${table(name)}`).get()?.n ?? 0);
  }
  return counts;
}

/** The id of a document, or null when it has none usable. */
function docId(/** @type {unknown} */ doc) {
  if (!doc || typeof doc !== "object") return null;
  const id = /** @type {{ id?: unknown }} */ (doc).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Apply an incremental change set in one transaction.
 * @param {SqliteConnection} conn
 * @param {ChangeSet} changes
 * @param {string} [now]
 */
export function applyChanges(conn, changes, now = new Date().toISOString()) {
  if (!changes.collections.length && changes.settings === null) return;
  transaction(conn, () => {
    for (const change of changes.collections) {
      if (change.upserts.length) {
        const upsert = cached(
          conn,
          `INSERT INTO ${table(change.name)} (id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`,
        );
        for (const { id, json } of change.upserts) upsert.run(id, json, now);
      }
      if (change.deletes.length) {
        const del = cached(conn, `DELETE FROM ${table(change.name)} WHERE id = ?`);
        for (const id of change.deletes) del.run(id);
      }
      if (change.order?.length) reorderRows(conn, change.name, change.order);
    }
    if (changes.settings !== null) writeSettings(conn, changes.settings, now);
  });
}

/**
 * Make `ORDER BY rowid` return the rows in the order of `ids` by moving them,
 * in that order, to fresh rowids above every existing one.
 */
function reorderRows(/** @type {SqliteConnection} */ conn, /** @type {string} */ name, /** @type {string[]} */ ids) {
  const highest = Number(conn.prepare(`SELECT max(rowid) AS m FROM ${table(name)}`).get()?.m ?? 0);
  const move = cached(conn, `UPDATE ${table(name)} SET rowid = ? WHERE id = ?`);
  ids.forEach((id, index) => move.run(highest + 1 + index, id));
}

function writeSettings(/** @type {SqliteConnection} */ conn, /** @type {string} */ json, /** @type {string} */ now) {
  cached(conn, "INSERT INTO settings (id, doc, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at").run(json, now);
}

/**
 * Replace the whole database with `data` in one transaction: every
 * collection table present in the file or in `data` ends up holding exactly
 * the documents of `data` (tables missing from `data` are emptied).
 * Documents without an id are rejected; duplicate ids keep the first copy.
 *
 * With `initialize`, nothing is written when the file already holds a
 * database (another process got there first) and false is returned.
 *
 * @param {SqliteConnection} conn
 * @param {RawData} data
 * @param {{ source?: string; initialize?: boolean }} [options]
 * @returns {boolean} whether the data was written
 */
export function writeAllData(conn, data, options = {}) {
  const now = new Date().toISOString();
  return transaction(conn, () => {
    if (options.initialize && isInitialized(conn)) return false;
    const names = new Set([...listCollectionTables(conn), ...Object.keys(data.collections)]);
    for (const name of names) {
      ensureCollectionTable(conn, name);
      conn.exec(`DELETE FROM ${table(name)}`);
      const docs = data.collections[name] ?? [];
      if (!docs.length) continue;
      const insert = cached(conn, `INSERT INTO ${table(name)} (id, doc, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING`);
      docs.forEach((doc, index) => {
        const id = docId(doc);
        if (!id) throw new Error(`Collection "${name}", item ${index + 1} has no id.`);
        insert.run(id, JSON.stringify(doc), now);
      });
    }
    if (data.settings && typeof data.settings === "object") writeSettings(conn, JSON.stringify(data.settings), now);
    else conn.exec("DELETE FROM settings");
    if (!getMeta(conn, "initialized_at")) {
      setMeta(conn, "initialized_at", now);
      if (options.source) setMeta(conn, "initialized_from", options.source);
    } else if (options.source) {
      setMeta(conn, "last_replaced_at", now);
      setMeta(conn, "last_replaced_from", options.source);
    }
    return true;
  });
}

/**
 * Write `data` into a brand-new SQLite file (which must not exist yet),
 * folded into a single file without -wal/-shm companions.
 *
 * @param {string} file
 * @param {RawData} data
 * @param {{ collections?: readonly string[]; source?: string }} [options]
 */
export function createDatabaseFile(file, data, options = {}) {
  if (fs.existsSync(file)) throw new Error(`${file} already exists.`);
  const conn = openDatabase(file);
  try {
    migrate(conn, options.collections ?? Object.keys(data.collections));
    writeAllData(conn, data, { source: options.source ?? "import" });
    conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    conn.exec("PRAGMA journal_mode = DELETE");
  } finally {
    conn.close();
  }
}

/* ------------------------------------------------------------------ */
/* JSON documents (db.json, JSON backups)                              */
/* ------------------------------------------------------------------ */

/**
 * Turn a parsed db.json-style object (`{ users: [...], …, settings: {...} }`)
 * into RawData, validating every document. Unknown non-array keys are ignored.
 *
 * @param {unknown} parsed
 * @returns {RawData}
 */
export function rawDataFromJson(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The file does not contain a database: expected a JSON object with one array per collection.");
  }
  /** @type {Record<string, unknown[]>} */
  const collections = {};
  let settings = null;
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "settings") {
      if (value && typeof value === "object" && !Array.isArray(value)) settings = value;
      continue;
    }
    if (!Array.isArray(value)) continue;
    assertCollectionName(key);
    value.forEach((doc, index) => {
      if (!docId(doc)) throw new Error(`Collection "${key}", item ${index + 1} has no id.`);
    });
    collections[key] = value;
  }
  return { collections, settings };
}

/** Serialize RawData in the db.json format (collections first, then settings). */
export function rawDataToJson(/** @type {RawData} */ data, pretty = true) {
  /** @type {Record<string, unknown>} */
  const out = { ...data.collections };
  if (data.settings) out.settings = data.settings;
  return JSON.stringify(out, null, pretty ? 2 : undefined);
}

/* ------------------------------------------------------------------ */
/* Backup files                                                        */
/* ------------------------------------------------------------------ */

/** @typedef {"auto" | "manual" | "safety" | "upload"} BackupKind */
/** @typedef {"sqlite" | "json"} BackupFormat */
/**
 * Sidecar written next to every backup (`<name>.manifest.json`).
 * @typedef {object} BackupManifest
 * @property {1} version
 * @property {BackupKind} kind
 * @property {BackupFormat} format
 * @property {string} createdAt
 * @property {number} sizeBytes
 * @property {number | null} schemaVersion
 * @property {Record<string, number>} counts
 * @property {number} records
 * @property {string} [reason]
 * @property {string} [createdBy]
 * @property {string} [originalName]
 */

export const BACKUP_KINDS = /** @type {const} */ (["auto", "manual", "safety", "upload"]);

const BACKUP_NAME = /^lms-(\d{8})(?:-(\d{6}))?-(auto|manual|safety|upload)(?:-(\d{1,3}))?\.(sqlite|json)$/;
const MANIFEST_SUFFIX = ".manifest.json";
const SQLITE_MAGIC = "SQLite format 3\u0000";

/** Folder holding backups for a database file: `<dir of the database>/backups`. */
export function backupsDirFor(/** @type {string} */ databaseFile) {
  return path.join(path.dirname(databaseFile), "backups");
}

function pad(/** @type {number} */ n, width = 2) {
  return String(n).padStart(width, "0");
}

/** Local calendar day as YYYYMMDD. */
export function backupDayKey(/** @type {Date} */ date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

/**
 * File name for a new backup. Automatic backups carry only the day (one per
 * day, so two processes racing produce one file); the others carry the time.
 *
 * @param {BackupKind} kind
 * @param {BackupFormat} format
 * @param {Date} [date]
 * @param {number} [suffix]  Disambiguates backups taken within the same second.
 */
export function backupFileName(kind, format, date = new Date(), suffix = 0) {
  const day = backupDayKey(date);
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const base = kind === "auto" ? `lms-${day}-auto` : `lms-${day}-${time}-${kind}`;
  return `${base}${suffix > 0 ? `-${suffix}` : ""}.${format}`;
}

/**
 * Parse a backup file name; null for anything else (which also rejects path
 * separators, so a valid name is always a plain file inside the folder).
 *
 * @param {string} name
 * @returns {{ kind: BackupKind; format: BackupFormat; date: Date } | null}
 */
export function parseBackupFileName(name) {
  const m = BACKUP_NAME.exec(name);
  if (!m) return null;
  const [, day, time, kind, , format] = m;
  const date = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    time ? Number(time.slice(0, 2)) : 0,
    time ? Number(time.slice(2, 4)) : 0,
    time ? Number(time.slice(4, 6)) : 0,
  );
  if (Number.isNaN(date.getTime())) return null;
  return { kind: /** @type {BackupKind} */ (kind), format: /** @type {BackupFormat} */ (format), date };
}

/** Detect a backup's format from its first bytes. */
export function detectFormat(/** @type {string} */ file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(64);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, read);
    if (head.subarray(0, 16).toString("latin1") === SQLITE_MAGIC) return /** @type {BackupFormat} */ ("sqlite");
    const text = head.toString("utf8").replace(/^﻿/, "").trimStart();
    if (text.startsWith("{")) return /** @type {BackupFormat} */ ("json");
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const NOT_A_BACKUP = "This is not a database backup: expected a .sqlite file made by this app or a JSON export.";
const UNREADABLE_BACKUP = "The backup is damaged: SQLite cannot read it.";

/**
 * Validate a backup file and summarize it without loading it into the
 * store. SQLite files get an integrity check (skipped with
 * `integrity: false`, for a snapshot SQLite has just written itself); JSON
 * files are parsed.
 *
 * @param {string} file
 * @param {{ integrity?: boolean }} [options]
 * @returns {{ format: BackupFormat; schemaVersion: number | null; counts: Record<string, number>; records: number; hasSettings: boolean }}
 */
export function inspectBackupFile(file, options = {}) {
  const format = detectFormat(file);
  if (!format) throw new Error(NOT_A_BACKUP);
  if (format === "json") {
    const data = readJsonFile(file);
    return { format, schemaVersion: null, ...countDocuments(data), hasSettings: Boolean(data.settings) };
  }
  return withBackupConnection(file, options.integrity !== false, (conn, schemaVersion) => {
    const counts = countRows(conn);
    const hasSettings = Boolean(conn.prepare("SELECT 1 AS found FROM settings WHERE id = 1").get());
    return { format, schemaVersion, counts, records: sum(counts), hasSettings };
  });
}

/**
 * Load a backup (either format) as RawData.
 * @param {string} file
 * @returns {{ format: BackupFormat; data: RawData }}
 */
export function readBackupData(file) {
  const format = detectFormat(file);
  if (format === "json") return { format, data: readJsonFile(file) };
  if (format !== "sqlite") throw new Error(NOT_A_BACKUP);
  return withBackupConnection(file, true, (conn) => ({ format, data: readAllData(conn) }));
}

/**
 * Open a SQLite backup read-only, check that it is one of ours (intact when
 * `integrity`, made by this app, not from a newer version) and run `fn`.
 * Anything SQLite cannot read is reported as a damaged backup.
 *
 * @template T
 * @param {string} file
 * @param {boolean} integrity
 * @param {(conn: SqliteConnection, schemaVersion: number) => T} fn
 * @returns {T}
 */
function withBackupConnection(file, integrity, fn) {
  /** @type {SqliteConnection | null} */
  let conn = null;
  // A copy of a WAL-mode database (a raw copy of the live file, say) makes even a read-only
  // connection create -wal and -shm files that it cannot remove; remove those it created.
  const created = SIDECAR_SUFFIXES.filter((suffix) => !fs.existsSync(file + suffix));
  try {
    conn = openDatabase(file, { readOnly: true });
    if (integrity) {
      const result = checkIntegrity(conn);
      if (!result.ok) throw new Error(`The backup is damaged (${result.messages.slice(0, 3).join("; ")}).`);
    }
    if (!tableExists(conn, "meta") || !tableExists(conn, "settings")) throw new Error("This SQLite file was not created by this app (it has no meta/settings tables).");
    const schemaVersion = Number(getMeta(conn, "schema_version") ?? 0) || 0;
    if (schemaVersion > SCHEMA_VERSION) throw new Error(`The backup was made by a newer version of the app (schema ${schemaVersion}); update the app first.`);
    return fn(conn, schemaVersion);
  } catch (err) {
    throw isCorruptionError(err) ? new Error(UNREADABLE_BACKUP) : err;
  } finally {
    conn?.close();
    for (const suffix of created) removeQuietly(file + suffix);
  }
}

/** Files SQLite may keep next to a database file. */
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];

/** Remove a file if it exists; a failure (the file is in use) is not an error here. */
function removeQuietly(/** @type {string} */ file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // Left for the next deleteBackupFile() of this backup.
  }
}

/** Documents per collection, and in total, of `data`. */
export function countDocuments(/** @type {RawData} */ data) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [name, docs] of Object.entries(data.collections)) counts[name] = docs.length;
  return { counts, records: sum(counts) };
}

/** Parse a db.json-style file. */
export function readJsonFile(/** @type {string} */ file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`The JSON file could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return rawDataFromJson(parsed);
}

function sum(/** @type {Record<string, number>} */ counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/**
 * Copy a live database into `target` with `VACUUM INTO` (a consistent,
 * compacted snapshot that works while the app keeps writing). Fails when
 * `target` exists.
 */
export function vacuumInto(/** @type {SqliteConnection} */ conn, /** @type {string} */ target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  conn.prepare("VACUUM INTO ?").run(target);
}

/** Path of a backup's manifest. */
export function manifestPath(/** @type {string} */ backupFile) {
  return `${backupFile}${MANIFEST_SUFFIX}`;
}

/** @param {string} backupFile @param {BackupManifest} manifest */
export function writeManifest(backupFile, manifest) {
  fs.writeFileSync(manifestPath(backupFile), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** @returns {BackupManifest | null} */
export function readManifest(/** @type {string} */ backupFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath(backupFile), "utf8"));
    return parsed && parsed.version === 1 && parsed.counts && typeof parsed.counts === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Build (and store) a manifest for an existing backup file.
 * @param {string} file
 * @param {{ kind: BackupKind; createdAt?: string; reason?: string; createdBy?: string; originalName?: string; counts?: Record<string, number>; schemaVersion?: number | null }} info
 * @returns {BackupManifest}
 */
export function describeBackup(file, info) {
  const stat = fs.statSync(file);
  let counts = info.counts;
  let schemaVersion = info.schemaVersion ?? null;
  let format = /** @type {BackupFormat} */ (file.endsWith(".json") ? "json" : "sqlite");
  if (!counts) {
    const summary = inspectBackupFile(file);
    counts = summary.counts;
    schemaVersion = summary.schemaVersion;
    format = summary.format;
  }
  /** @type {BackupManifest} */
  const manifest = {
    version: 1,
    kind: info.kind,
    format,
    createdAt: info.createdAt ?? stat.mtime.toISOString(),
    sizeBytes: stat.size,
    schemaVersion,
    counts,
    records: sum(counts),
  };
  if (info.reason) manifest.reason = info.reason;
  if (info.createdBy) manifest.createdBy = info.createdBy;
  if (info.originalName) manifest.originalName = info.originalName;
  writeManifest(file, manifest);
  return manifest;
}

/**
 * @typedef {object} BackupEntry
 * @property {string} name
 * @property {string} file
 * @property {BackupKind} kind
 * @property {BackupFormat} format
 * @property {string} createdAt
 * @property {number} sizeBytes
 * @property {BackupManifest | null} manifest
 */

/**
 * Backups in `dir`, newest first. Files that do not follow the naming
 * scheme (and manifests) are ignored.
 * @param {string} dir
 * @returns {BackupEntry[]}
 */
export function listBackupFiles(dir) {
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return [];
    throw err;
  }
  /** @type {BackupEntry[]} */
  const out = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (!parsed) continue;
    const file = path.join(dir, name);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const manifest = readManifest(file);
    out.push({
      name,
      file,
      kind: parsed.kind,
      format: parsed.format,
      createdAt: manifest?.createdAt ?? parsed.date.toISOString(),
      sizeBytes: stat.size,
      manifest,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.name.localeCompare(a.name)));
}

/** Delete a backup, its manifest and any -wal/-shm/-journal file SQLite left next to it. */
export function deleteBackupFile(/** @type {string} */ file) {
  fs.rmSync(file, { force: true });
  fs.rmSync(manifestPath(file), { force: true });
  for (const suffix of SIDECAR_SUFFIXES) fs.rmSync(file + suffix, { force: true });
}

/**
 * Keep the newest `keep` backups of `kind`; delete the rest. Names in
 * `protect` are never deleted and do not count towards `keep`.
 *
 * @param {string} dir
 * @param {BackupKind} kind
 * @param {number} keep
 * @param {readonly string[]} [protect]
 * @returns {string[]} names of deleted backups
 */
export function pruneBackups(dir, kind, keep, protect = []) {
  const old = listBackupFiles(dir)
    .filter((entry) => entry.kind === kind && !protect.includes(entry.name))
    .slice(Math.max(0, keep));
  for (const entry of old) deleteBackupFile(entry.file);
  return old.map((entry) => entry.name);
}

/** A backup path in `dir` that does not exist yet (automatic backups: the day's single name). */
export function freeBackupPath(/** @type {string} */ dir, /** @type {BackupKind} */ kind, /** @type {BackupFormat} */ format, date = new Date()) {
  if (kind === "auto") return path.join(/* turbopackIgnore: true */ dir, backupFileName(kind, format, date));
  for (let suffix = 0; suffix < 1000; suffix++) {
    const file = path.join(/* turbopackIgnore: true */ dir, backupFileName(kind, format, date, suffix));
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) return file;
  }
  throw new Error("Too many backups were created in the same second.");
}

/* ------------------------------------------------------------------ */
/* Configuration for scripts                                           */
/* ------------------------------------------------------------------ */

/**
 * Where the data lives, from the same variables the app reads
 * (DB_DRIVER, SQLITE_PATH, DATA_FILE), resolved against `cwd`.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 */
export function resolveStorageConfig(env, cwd) {
  const read = (/** @type {string} */ name) => (env[name] ?? "").trim();
  const driver = read("DB_DRIVER").toLowerCase() === "json" ? "json" : "sqlite";
  const sqlitePath = path.resolve(cwd, read("SQLITE_PATH") || "storage/lms.sqlite");
  const dataFile = path.resolve(cwd, read("DATA_FILE") || "storage/db.json");
  return {
    driver: /** @type {"json" | "sqlite"} */ (driver),
    sqlitePath,
    dataFile,
    backupsDir: backupsDirFor(driver === "json" ? dataFile : sqlitePath),
  };
}
