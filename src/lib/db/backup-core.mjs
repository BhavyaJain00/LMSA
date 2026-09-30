/**
 * Backup and restore on files, shared by the running app
 * (`src/lib/db/backup.ts`) and the offline CLI scripts (`scripts/db-*.mjs`):
 * retention, temporary files, publishing a finished snapshot under its
 * final name, checking that a backup can be restored, and the offline
 * backup / restore / JSON export themselves.
 *
 * Plain JavaScript typed with JSDoc (like `sqlite-core.mjs`) so the scripts
 * can import it without a build step. Node built-ins only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  backupFileName,
  checkIntegrity,
  countDocuments,
  createDatabaseFile,
  deleteBackupFile,
  describeBackup,
  freeBackupPath,
  inspectBackupFile,
  isBusyError,
  isCorruptionError,
  listBackupFiles,
  migrate,
  openDatabase,
  parseBackupFileName,
  pruneBackups,
  rawDataToJson,
  readAllData,
  readBackupData,
  readJsonFile,
  vacuumInto,
  writeAllData,
} from "./sqlite-core.mjs";

/** @typedef {import("./sqlite-core.mjs").BackupKind} BackupKind */
/** @typedef {import("./sqlite-core.mjs").BackupFormat} BackupFormat */
/** @typedef {import("./sqlite-core.mjs").BackupEntry} BackupEntry */
/** @typedef {import("./sqlite-core.mjs").RawData} RawData */
/** @typedef {ReturnType<typeof import("./sqlite-core.mjs").resolveStorageConfig>} StorageConfig */

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

/**
 * How many backups of each kind are kept. Manual backups stay until an
 * administrator deletes them.
 */
export const BACKUP_RETENTION = Object.freeze({ auto: 14, safety: 10, upload: 5 });

const OFF = new Set(["false", "0", "no", "off"]);

/**
 * Backups of `kind` to keep, or null for "all". DB_BACKUP_KEEP overrides the
 * number of automatic daily backups (1–3650).
 *
 * @param {BackupKind} kind
 * @param {Record<string, string | undefined>} [env]
 * @returns {number | null}
 */
export function retentionFor(kind, env = process.env) {
  if (kind === "manual") return null;
  if (kind === "auto") {
    const text = (env.DB_BACKUP_KEEP ?? "").trim();
    const keep = /^\d{1,4}$/.test(text) ? Number(text) : 0;
    if (keep >= 1 && keep <= 3650) return keep;
  }
  return BACKUP_RETENTION[kind];
}

/** The daily backup runs unless DB_AUTO_BACKUP is false/0/no/off. */
export function automaticBackupsEnabled(/** @type {Record<string, string | undefined>} */ env = process.env) {
  return !OFF.has((env.DB_AUTO_BACKUP ?? "").trim().toLowerCase());
}

/**
 * State of the daily backup in this process (on `globalThis`, so hot
 * reloading and separately bundled server entries share it).
 *
 * @typedef {object} AutomaticBackupState
 * @property {number} nextCheckAt  Time (ms) before which the store does not look at the calendar again.
 * @property {Promise<unknown> | null} running
 * @property {string | null} lastRunAt  When the last automatic backup was written by this process.
 * @property {{ message: string; at: string } | null} lastError
 */

/** @returns {AutomaticBackupState} */
export function automaticBackupState() {
  const g = /** @type {{ __llAutomaticBackup?: AutomaticBackupState }} */ (globalThis);
  return (g.__llAutomaticBackup ??= { nextCheckAt: 0, running: null, lastRunAt: null, lastError: null });
}

/** The first moment of the local day after `now` (ms). */
export function nextLocalMidnight(/** @type {number} */ now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

/* ------------------------------------------------------------------ */
/* Temporary files                                                     */
/* ------------------------------------------------------------------ */

const TEMP_FILE = /^\.tmp-\d+-[0-9a-f]{12}\.(?:sqlite|json|part)(?:-journal|-wal|-shm)?$/;
const STALE_TEMP_MS = 6 * 60 * 60 * 1000;

/**
 * A fresh path inside the backups folder for a snapshot or upload in
 * progress. The name never matches a backup name, so unfinished files are
 * not listed; leftovers of a crashed process are removed by
 * `removeStaleTempFiles`.
 *
 * @param {string} dir
 * @param {"sqlite" | "json" | "part"} extension
 */
export function tempBackupPath(dir, extension) {
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}.${extension}`);
}

/**
 * Delete temporary files older than `maxAgeMs` (left by a process that
 * stopped half-way). Only names produced by `tempBackupPath` are touched.
 *
 * @returns {string[]} names of the removed files
 */
export function removeStaleTempFiles(/** @type {string} */ dir, maxAgeMs = STALE_TEMP_MS, now = Date.now()) {
  /** @type {string[]} */
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const removed = [];
  for (const name of names) {
    if (!TEMP_FILE.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (now - fs.statSync(file).mtimeMs < maxAgeMs) continue;
      fs.rmSync(file, { force: true });
      removed.push(name);
    } catch {
      // In use or already gone: try again next time.
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/* Backups folder                                                      */
/* ------------------------------------------------------------------ */

/**
 * The backup called `name` in `dir`, or null. Only names following the
 * backup naming scheme are accepted, which also rules out path separators.
 *
 * @param {string} dir
 * @param {unknown} name
 * @returns {BackupEntry | null}
 */
export function getBackupEntry(dir, name) {
  if (typeof name !== "string" || !parseBackupFileName(name)) return null;
  return listBackupFiles(dir).find((entry) => entry.name === name) ?? null;
}

/**
 * Move a finished temporary file into the backups folder under its final
 * name, write its manifest and apply the retention of its kind.
 *
 * An automatic backup has one name per day: when that file already exists
 * (another process was faster) the temporary file is discarded and the
 * existing backup is returned with `created: false`.
 *
 * @param {string} tmp
 * @param {string} dir
 * @param {BackupKind} kind
 * @param {object} info
 * @param {BackupFormat} info.format
 * @param {Date} [info.date]
 * @param {string} [info.reason]
 * @param {string} [info.createdBy]
 * @param {string} [info.originalName]
 * @param {Record<string, number>} [info.counts]  Known row counts; the file is inspected when missing.
 * @param {number | null} [info.schemaVersion]
 * @param {readonly string[]} [info.protect]  Backups the retention must not delete.
 * @returns {{ entry: BackupEntry; created: boolean; pruned: string[] }}
 */
export function publishBackup(tmp, dir, kind, info) {
  const date = info.date ?? new Date();
  const target = freeBackupPath(dir, kind, info.format, date);
  if (kind === "auto" && fs.existsSync(target)) {
    fs.rmSync(tmp, { force: true });
    const existing = getBackupEntry(dir, path.basename(target));
    if (existing) return { entry: existing, created: false, pruned: [] };
  }
  fs.renameSync(tmp, target);
  try {
    describeBackup(target, {
      kind,
      createdAt: date.toISOString(),
      reason: info.reason,
      createdBy: info.createdBy,
      originalName: info.originalName,
      counts: info.counts,
      schemaVersion: info.schemaVersion,
    });
  } catch (err) {
    deleteBackupFile(target);
    throw err;
  }
  const name = path.basename(target);
  const keep = retentionFor(kind);
  const pruned = keep === null ? [] : pruneBackups(dir, kind, keep, [name, ...(info.protect ?? [])]);
  const entry = getBackupEntry(dir, name);
  if (!entry) throw new Error(`The backup ${name} disappeared while it was being saved.`);
  return { entry, created: true, pruned };
}

/**
 * Turn a command-line argument into a backup file: "latest", a path, or the
 * name of a backup in the backups folder.
 *
 * @param {string} backupsDir
 * @param {string} arg
 * @param {string} cwd
 */
export function resolveBackupSource(backupsDir, arg, cwd) {
  if (arg === "latest") {
    const newest = listBackupFiles(backupsDir)[0];
    if (!newest) throw new Error(`There are no backups in ${backupsDir}.`);
    return newest.file;
  }
  const direct = path.resolve(cwd, arg);
  try {
    if (fs.statSync(direct).isFile()) return direct;
  } catch {
    // Not a path: maybe a backup name.
  }
  const entry = getBackupEntry(backupsDir, arg);
  if (entry) return entry.file;
  throw new Error(`Backup not found: "${arg}" is neither a file nor a backup in ${backupsDir}.`);
}

/* ------------------------------------------------------------------ */
/* Can this backup be restored?                                        */
/* ------------------------------------------------------------------ */

/**
 * Check that restoring `data` leaves a usable site.
 *
 *  - errors: restoring would lock everyone out (no members, or no enabled
 *    administrator);
 *  - warnings: things the administrator should know before confirming
 *    (default settings, collections this version does not store, collections
 *    added after the backup was made).
 *
 * @param {RawData} data
 * @param {readonly string[]} [knownCollections]  The app's collections; omit when unknown (offline scripts).
 * @returns {{ errors: string[]; warnings: string[]; unknownCollections: string[]; missingCollections: string[] }}
 */
export function checkRestorable(data, knownCollections) {
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const warnings = [];
  const users = /** @type {{ roles?: unknown; enabled?: unknown }[]} */ (data.collections.users ?? []);
  if (!users.length) {
    errors.push("The backup contains no member accounts, so nobody could sign in after restoring it.");
  } else if (!users.some((user) => Array.isArray(user?.roles) && user.roles.includes("admin") && user.enabled !== false)) {
    errors.push("The backup contains no enabled administrator account, so nobody could manage the site after restoring it.");
  }
  if (!data.settings || typeof data.settings !== "object") {
    warnings.push("The backup has no site settings: the default settings will be used.");
  }
  /** @type {string[]} */
  let unknownCollections = [];
  /** @type {string[]} */
  let missingCollections = [];
  if (knownCollections) {
    const known = new Set(knownCollections);
    unknownCollections = Object.keys(data.collections).filter((name) => !known.has(name) && data.collections[name].length > 0);
    missingCollections = knownCollections.filter((name) => !Object.hasOwn(data.collections, name));
    if (unknownCollections.length) {
      warnings.push(`This version of the app does not store ${listNames(unknownCollections)}: those records will be left out.`);
    }
    if (missingCollections.length) {
      warnings.push(`The backup was made before ${listNames(missingCollections)} existed: ${missingCollections.length === 1 ? "that collection" : "those collections"} will start empty.`);
    }
  }
  return { errors, warnings, unknownCollections, missingCollections };
}

/** "a, b, c and 4 more" */
function listNames(/** @type {string[]} */ names, max = 4) {
  const shown = names.slice(0, max).join(", ");
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

/* ------------------------------------------------------------------ */
/* Offline operations (CLI scripts)                                    */
/* ------------------------------------------------------------------ */

/** A timestamp that is safe in file names: 2026-09-30T04-57-18-654Z. */
function fileStamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/** "stop the app" hint for rename/unlink failures caused by an open file. */
function inUse(/** @type {unknown} */ err) {
  const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

/**
 * State of the live SQLite file before a restore.
 *
 * @param {string} file
 * @returns {{ state: "missing" | "healthy" | "damaged"; messages: string[] }}
 */
export function probeDatabase(file) {
  if (!fs.existsSync(file)) return { state: "missing", messages: [] };
  let conn;
  try {
    conn = openDatabase(file);
    const integrity = checkIntegrity(conn);
    return integrity.ok ? { state: "healthy", messages: [] } : { state: "damaged", messages: integrity.messages };
  } catch (err) {
    if (isCorruptionError(err)) return { state: "damaged", messages: [err instanceof Error ? err.message : String(err)] };
    if (isBusyError(err)) throw new Error(`${file} is locked by another process. Wait for it to finish (or stop the app) and try again.`);
    throw err;
  } finally {
    conn?.close();
  }
}

/**
 * Back up the configured database without the app: `VACUUM INTO` for
 * SQLite (safe while the app is running), a validated copy for the JSON
 * driver. With `out` the snapshot is written to that path instead of the
 * backups folder.
 *
 * @param {StorageConfig} config
 * @param {{ kind?: BackupKind; out?: string; reason?: string; createdBy?: string; date?: Date }} [options]
 * @returns {{ file: string; entry: BackupEntry | null; created: boolean; pruned: string[]; records: number; counts: Record<string, number> }}
 */
export function backupOffline(config, options = {}) {
  const kind = options.kind ?? "manual";
  const date = options.date ?? new Date();
  const format = config.driver === "json" ? "json" : "sqlite";
  const dir = config.backupsDir;
  if (options.out && fs.existsSync(options.out)) throw new Error(`${options.out} already exists.`);

  if (kind === "auto" && !options.out) {
    const todays = getBackupEntry(dir, backupFileName("auto", format, date));
    if (todays) {
      const counts = todays.manifest?.counts ?? {};
      return { file: todays.file, entry: todays, created: false, pruned: [], records: todays.manifest?.records ?? 0, counts };
    }
  }

  removeStaleTempFiles(dir);
  const tmp = tempBackupPath(dir, format);
  try {
    /** @type {{ counts: Record<string, number>; records: number; schemaVersion: number | null }} */
    let summary;
    if (config.driver === "json") {
      if (!fs.existsSync(config.dataFile)) throw new Error(`There is no database at ${config.dataFile} yet.`);
      summary = { ...countDocuments(readJsonFile(config.dataFile)), schemaVersion: null };
      fs.copyFileSync(config.dataFile, tmp, fs.constants.COPYFILE_EXCL);
    } else {
      const probe = probeDatabase(config.sqlitePath);
      if (probe.state === "missing") throw new Error(`There is no database at ${config.sqlitePath} yet.`);
      if (probe.state === "damaged") {
        throw new Error(`${config.sqlitePath} failed its integrity check (${probe.messages.slice(0, 3).join("; ")}). A copy of it would be damaged too: restore a backup instead.`);
      }
      const conn = openDatabase(config.sqlitePath);
      try {
        vacuumInto(conn, tmp);
      } finally {
        conn.close();
      }
      summary = inspectBackupFile(tmp, { integrity: false });
    }

    if (options.out) {
      fs.mkdirSync(path.dirname(options.out), { recursive: true });
      fs.renameSync(tmp, options.out);
      return { file: options.out, entry: null, created: true, pruned: [], records: summary.records, counts: summary.counts };
    }
    const published = publishBackup(tmp, dir, kind, {
      format,
      date,
      reason: options.reason,
      createdBy: options.createdBy,
      counts: summary.counts,
      schemaVersion: summary.schemaVersion,
    });
    return { file: published.entry.file, entry: published.entry, created: published.created, pruned: published.pruned, records: summary.records, counts: summary.counts };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Replace the configured database with the contents of a backup file
 * (.sqlite or JSON export), without the app.
 *
 *  - A healthy SQLite database is first copied to a "safety" backup, then
 *    replaced in ONE transaction: a crash leaves either the old or the new
 *    contents, and a running app notices the change and reloads.
 *  - A damaged SQLite database cannot be copied or written: its files are
 *    moved aside as `<name>.damaged-<timestamp>` (never deleted) and a new
 *    file is built next to it and renamed into place. The app must be
 *    stopped for this.
 *  - The JSON driver's file is copied to a safety backup and replaced with
 *    a rename. A running app keeps its own copy in memory: restart it.
 *
 * @param {StorageConfig} config
 * @param {string} sourceFile
 * @param {{ safetyBackup?: boolean; force?: boolean }} [options]
 * @returns {{
 *   mode: "transaction" | "replaced-damaged" | "created" | "json";
 *   format: BackupFormat;
 *   records: number;
 *   counts: Record<string, number>;
 *   safety: BackupEntry | null;
 *   movedAside: string[];
 *   warnings: string[];
 * }}
 */
export function restoreOffline(config, sourceFile, options = {}) {
  const { format, data } = readBackupData(sourceFile);
  const check = checkRestorable(data);
  if (check.errors.length && !options.force) throw new Error(check.errors.join(" "));
  const warnings = [...(options.force ? check.errors : []), ...check.warnings];
  const label = path.basename(sourceFile);
  const source = `restore:${label}`;
  const { counts, records } = countDocuments(data);
  const dir = config.backupsDir;
  const wantSafety = options.safetyBackup !== false;
  // The file being restored must survive the retention applied to the safety backup.
  const protect = path.dirname(path.resolve(sourceFile)) === path.resolve(dir) ? [label] : [];
  /** @type {BackupEntry | null} */
  let safety = null;
  /** @type {string[]} */
  const movedAside = [];

  if (config.driver === "json") {
    const target = config.dataFile;
    if (wantSafety && fs.existsSync(target)) {
      const tmp = tempBackupPath(dir, "json");
      fs.copyFileSync(target, tmp, fs.constants.COPYFILE_EXCL);
      /** @type {Record<string, number>} */
      let current = {};
      try {
        current = countDocuments(readJsonFile(target)).counts;
      } catch {
        warnings.push(`${target} could not be read as a database; it was kept as a safety backup anyway.`);
      }
      safety = publishBackup(tmp, dir, "safety", { format: "json", reason: `Before restoring ${label}`, counts: current, schemaVersion: null, protect }).entry;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmpTarget = `${target}.restore-${process.pid}.tmp`;
    fs.writeFileSync(tmpTarget, rawDataToJson(data), "utf8");
    fs.renameSync(tmpTarget, target);
    return { mode: "json", format, records, counts, safety, movedAside, warnings };
  }

  const target = config.sqlitePath;
  const probe = probeDatabase(target);

  if (probe.state === "healthy") {
    const conn = openDatabase(target);
    try {
      if (wantSafety) {
        const tmp = tempBackupPath(dir, "sqlite");
        try {
          vacuumInto(conn, tmp);
          const summary = inspectBackupFile(tmp, { integrity: false });
          safety = publishBackup(tmp, dir, "safety", {
            format: "sqlite",
            reason: `Before restoring ${label}`,
            counts: summary.counts,
            schemaVersion: summary.schemaVersion,
            protect,
          }).entry;
        } catch (err) {
          fs.rmSync(tmp, { force: true });
          throw err;
        }
      }
      migrate(conn, Object.keys(data.collections));
      writeAllData(conn, data, { source });
    } catch (err) {
      if (isBusyError(err)) throw new Error(`${target} is locked by another process. Wait for it to finish (or stop the app) and try again.`);
      throw err;
    } finally {
      conn.close();
    }
    return { mode: "transaction", format, records, counts, safety, movedAside, warnings };
  }

  // Missing or damaged: build the new database next to the target, then swap it in.
  const tmpTarget = `${target}.restore-${process.pid}.tmp`;
  fs.rmSync(tmpTarget, { force: true });
  try {
    createDatabaseFile(tmpTarget, data, { source });
    if (probe.state === "damaged") {
      const stamp = fileStamp();
      for (const suffix of ["", "-wal", "-shm"]) {
        const from = `${target}${suffix}`;
        if (!fs.existsSync(from)) continue;
        const to = `${target}.damaged-${stamp}${suffix}`;
        try {
          fs.renameSync(from, to);
        } catch (err) {
          if (inUse(err)) throw new Error(`${from} is in use. Stop the app, then run the restore again.`);
          throw err;
        }
        movedAside.push(to);
      }
    }
    fs.renameSync(tmpTarget, target);
  } catch (err) {
    fs.rmSync(tmpTarget, { force: true });
    throw err;
  }
  return { mode: probe.state === "damaged" ? "replaced-damaged" : "created", format, records, counts, safety, movedAside, warnings };
}

/**
 * Write the configured database as a db.json-style document: to `out`
 * (which must not exist), or into the backups folder as a manual JSON
 * backup that the admin page lists and can restore.
 *
 * @param {StorageConfig} config
 * @param {{ out?: string; pretty?: boolean; date?: Date }} [options]
 * @returns {{ file: string; entry: BackupEntry | null; records: number; counts: Record<string, number> }}
 */
export function exportJsonOffline(config, options = {}) {
  const data = readLiveData(config);
  const json = rawDataToJson(data, options.pretty !== false);
  const { counts, records } = countDocuments(data);
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, json, { encoding: "utf8", flag: "wx" });
    return { file: options.out, entry: null, records, counts };
  }
  const tmp = tempBackupPath(config.backupsDir, "json");
  try {
    fs.writeFileSync(tmp, json, { encoding: "utf8", flag: "wx" });
    const { entry } = publishBackup(tmp, config.backupsDir, "manual", { format: "json", date: options.date, reason: "JSON export", counts, schemaVersion: null });
    return { file: entry.file, entry, records, counts };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Everything in the configured database, read without the app. */
export function readLiveData(/** @type {StorageConfig} */ config) {
  if (config.driver === "json") {
    if (!fs.existsSync(config.dataFile)) throw new Error(`There is no database at ${config.dataFile} yet.`);
    return readJsonFile(config.dataFile);
  }
  if (!fs.existsSync(config.sqlitePath)) throw new Error(`There is no database at ${config.sqlitePath} yet.`);
  let conn;
  try {
    conn = openDatabase(config.sqlitePath);
    return readAllData(conn);
  } catch (err) {
    if (isCorruptionError(err)) throw new Error(`${config.sqlitePath} is damaged and cannot be read. Restore a backup with "npm run db:restore -- latest".`);
    throw err;
  } finally {
    conn?.close();
  }
}
