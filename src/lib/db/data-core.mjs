/**
 * Database contents independent of where they are stored, shared by the
 * app (`store.ts`, `engine.ts`, `postgres.ts`, `backup.ts`) and the CLI
 * scripts (`scripts/db-*.mjs`): the RawData and change-set shapes, the JSON
 * export format (one array per collection plus `settings`) and the backup
 * files on disk (JSON exports with a manifest each).
 *
 * Plain JavaScript typed with JSDoc so `node scripts/db-backup.mjs` can
 * import it without a build step. Node built-ins only.
 */
import fs from "node:fs";
import path from "node:path";

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

/** Names that are not collections (the settings and meta tables). */
const RESERVED_NAMES = new Set(["meta", "settings"]);

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,62}$/;

/** Throw unless `name` can be a collection name. */
export function assertCollectionName(/** @type {string} */ name) {
  if (!IDENTIFIER.test(name) || RESERVED_NAMES.has(name.toLowerCase())) {
    throw new Error(`"${name}" cannot be used as a collection name.`);
  }
}

/** The id of a document, or null when it has none usable. */
export function docId(/** @type {unknown} */ doc) {
  if (!doc || typeof doc !== "object") return null;
  const id = /** @type {{ id?: unknown }} */ (doc).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/* ------------------------------------------------------------------ */
/* JSON exports                                                        */
/* ------------------------------------------------------------------ */

/**
 * Turn a parsed JSON export (`{ users: [...], …, settings: {...} }`) into
 * RawData, validating every document. Unknown non-array keys are ignored.
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

/** Serialize RawData as a JSON export (collections first, then settings). */
export function rawDataToJson(/** @type {RawData} */ data, pretty = true) {
  /** @type {Record<string, unknown>} */
  const out = { ...data.collections };
  if (data.settings) out.settings = data.settings;
  return JSON.stringify(out, null, pretty ? 2 : undefined);
}

/** Parse a JSON export file. */
export function readJsonFile(/** @type {string} */ file) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    throw new Error(`The JSON file could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return rawDataFromJson(parsed);
}

/** Documents per collection, and in total, of `data`. */
export function countDocuments(/** @type {RawData} */ data) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const [name, docs] of Object.entries(data.collections)) counts[name] = docs.length;
  return { counts, records: sum(counts) };
}

function sum(/** @type {Record<string, number>} */ counts) {
  return Object.values(counts).reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* Backup files                                                        */
/* ------------------------------------------------------------------ */

/** @typedef {"auto" | "manual" | "safety" | "upload"} BackupKind */
/** @typedef {"json"} BackupFormat */
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

const BACKUP_NAME = /^lms-(\d{8})(?:-(\d{6}))?-(auto|manual|safety|upload)(?:-(\d{1,3}))?\.json$/;
const MANIFEST_SUFFIX = ".manifest.json";
const SQLITE_MAGIC = "SQLite format 3\u0000";

/** Folder holding the backups: `<storage folder>/backups`. */
export function backupsDirIn(/** @type {string} */ storageDir) {
  return path.join(/* turbopackIgnore: true */ storageDir, "backups");
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
 * @param {Date} [date]
 * @param {number} [suffix]  Disambiguates backups taken within the same second.
 */
export function backupFileName(kind, date = new Date(), suffix = 0) {
  const day = backupDayKey(date);
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  const base = kind === "auto" ? `lms-${day}-auto` : `lms-${day}-${time}-${kind}`;
  return `${base}${suffix > 0 ? `-${suffix}` : ""}.json`;
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
  const [, day, time, kind] = m;
  const date = new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(4, 6)) - 1,
    Number(day.slice(6, 8)),
    time ? Number(time.slice(0, 2)) : 0,
    time ? Number(time.slice(2, 4)) : 0,
    time ? Number(time.slice(4, 6)) : 0,
  );
  if (Number.isNaN(date.getTime())) return null;
  return { kind: /** @type {BackupKind} */ (kind), format: "json", date };
}

const NOT_A_BACKUP = "This is not a database backup: expected a JSON export made by this app.";
const SQLITE_BACKUP =
  'This is a SQLite database from an older version of the app. Copy it into PostgreSQL with "npm run db:to-postgres -- <file>" instead.';

/** Check the first bytes of a backup: a JSON export, or a helpful error. */
function assertJsonBackup(/** @type {string} */ file) {
  const fd = fs.openSync(/* turbopackIgnore: true */ file, "r");
  try {
    const buf = Buffer.alloc(64);
    const read = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, read);
    if (head.subarray(0, 16).toString("latin1") === SQLITE_MAGIC) throw new Error(SQLITE_BACKUP);
    if (!head.toString("utf8").replace(/^﻿/, "").trimStart().startsWith("{")) throw new Error(NOT_A_BACKUP);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Validate a backup file (a JSON export) and summarize it without loading
 * it into the store.
 *
 * @param {string} file
 * @returns {{ format: BackupFormat; schemaVersion: number | null; counts: Record<string, number>; records: number; hasSettings: boolean }}
 */
export function inspectBackupFile(file) {
  const data = readBackupData(file).data;
  return { format: "json", schemaVersion: null, ...countDocuments(data), hasSettings: Boolean(data.settings) };
}

/**
 * Load a backup as RawData.
 * @param {string} file
 * @returns {{ format: BackupFormat; data: RawData }}
 */
export function readBackupData(file) {
  assertJsonBackup(file);
  return { format: "json", data: readJsonFile(file) };
}

/** Path of a backup's manifest. */
export function manifestPath(/** @type {string} */ backupFile) {
  return `${backupFile}${MANIFEST_SUFFIX}`;
}

/** @param {string} backupFile @param {BackupManifest} manifest */
export function writeManifest(backupFile, manifest) {
  fs.writeFileSync(/* turbopackIgnore: true */ manifestPath(backupFile), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

/** @returns {BackupManifest | null} */
export function readManifest(/** @type {string} */ backupFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ manifestPath(backupFile), "utf8"));
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
  const stat = fs.statSync(/* turbopackIgnore: true */ file);
  let counts = info.counts;
  let schemaVersion = info.schemaVersion ?? null;
  if (!counts) {
    const summary = inspectBackupFile(file);
    counts = summary.counts;
    schemaVersion = summary.schemaVersion;
  }
  /** @type {BackupManifest} */
  const manifest = {
    version: 1,
    kind: info.kind,
    format: "json",
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
    names = fs.readdirSync(/* turbopackIgnore: true */ dir);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === "ENOENT") return [];
    throw err;
  }
  /** @type {BackupEntry[]} */
  const out = [];
  for (const name of names) {
    const parsed = parseBackupFileName(name);
    if (!parsed) continue;
    const file = path.join(/* turbopackIgnore: true */ dir, name);
    let stat;
    try {
      stat = fs.statSync(/* turbopackIgnore: true */ file);
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

/** Delete a backup and its manifest. */
export function deleteBackupFile(/** @type {string} */ file) {
  fs.rmSync(/* turbopackIgnore: true */ file, { force: true });
  fs.rmSync(/* turbopackIgnore: true */ manifestPath(file), { force: true });
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
export function freeBackupPath(/** @type {string} */ dir, /** @type {BackupKind} */ kind, date = new Date()) {
  if (kind === "auto") return path.join(/* turbopackIgnore: true */ dir, backupFileName(kind, date));
  for (let suffix = 0; suffix < 1000; suffix++) {
    const file = path.join(/* turbopackIgnore: true */ dir, backupFileName(kind, date, suffix));
    if (!fs.existsSync(/* turbopackIgnore: true */ file)) return file;
  }
  throw new Error("Too many backups were created in the same second.");
}
