/**
 * Backup files, shared by the running app (`src/lib/db/backup.ts`) and the
 * CLI scripts (`scripts/db-*.mjs`): retention, temporary files, publishing
 * a finished JSON export under its final name and checking that a backup
 * can be restored.
 *
 * Plain JavaScript typed with JSDoc (like `data-core.mjs`) so the scripts
 * can import it without a build step. Node built-ins only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  countDocuments,
  deleteBackupFile,
  describeBackup,
  freeBackupPath,
  listBackupFiles,
  parseBackupFileName,
  pruneBackups,
  rawDataToJson,
} from "./data-core.mjs";

/** @typedef {import("./data-core.mjs").BackupKind} BackupKind */
/** @typedef {import("./data-core.mjs").BackupFormat} BackupFormat */
/** @typedef {import("./data-core.mjs").BackupEntry} BackupEntry */
/** @typedef {import("./data-core.mjs").RawData} RawData */

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

const TEMP_FILE = /^\.tmp-\d+-[0-9a-f]{12}\.(?:json|part)$/;
const STALE_TEMP_MS = 6 * 60 * 60 * 1000;

/**
 * A fresh path inside the backups folder for a snapshot or upload in
 * progress. The name never matches a backup name, so unfinished files are
 * not listed; leftovers of a crashed process are removed by
 * `removeStaleTempFiles`.
 *
 * @param {string} dir
 * @param {"json" | "part"} extension
 */
export function tempBackupPath(dir, extension) {
  fs.mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true });
  return path.join(/* turbopackIgnore: true */ dir, `.tmp-${process.pid}-${randomBytes(6).toString("hex")}.${extension}`);
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
    names = fs.readdirSync(/* turbopackIgnore: true */ dir);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const removed = [];
  for (const name of names) {
    if (!TEMP_FILE.test(name)) continue;
    const file = path.join(/* turbopackIgnore: true */ dir, name);
    try {
      if (now - fs.statSync(/* turbopackIgnore: true */ file).mtimeMs < maxAgeMs) continue;
      fs.rmSync(/* turbopackIgnore: true */ file, { force: true });
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
  const target = freeBackupPath(dir, kind, date);
  if (kind === "auto" && fs.existsSync(/* turbopackIgnore: true */ target)) {
    fs.rmSync(/* turbopackIgnore: true */ tmp, { force: true });
    const existing = getBackupEntry(dir, path.basename(target));
    if (existing) return { entry: existing, created: false, pruned: [] };
  }
  fs.renameSync(/* turbopackIgnore: true */ tmp, target);
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
  // The new backup counts towards `keep` and is never the one deleted.
  const pruned = keep === null ? [] : pruneBackups(dir, kind, Math.max(0, keep - 1), [name, ...(info.protect ?? [])]);
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
  const direct = path.resolve(/* turbopackIgnore: true */ cwd, arg);
  try {
    if (fs.statSync(/* turbopackIgnore: true */ direct).isFile()) return direct;
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
/* Writing a backup                                                    */
/* ------------------------------------------------------------------ */

/**
 * Write `data` as a JSON export into the backups folder (through a
 * temporary file, so an unfinished export is never listed) and apply the
 * retention of `kind`.
 *
 * @param {string} dir
 * @param {BackupKind} kind
 * @param {RawData} data
 * @param {{ date?: Date; reason?: string; createdBy?: string; originalName?: string; protect?: readonly string[]; pretty?: boolean }} [info]
 * @returns {{ entry: BackupEntry; created: boolean; pruned: string[]; records: number; counts: Record<string, number> }}
 */
export function writeJsonBackup(dir, kind, data, info = {}) {
  removeStaleTempFiles(dir);
  const { counts, records } = countDocuments(data);
  const tmp = tempBackupPath(dir, "json");
  try {
    fs.writeFileSync(/* turbopackIgnore: true */ tmp, rawDataToJson(data, info.pretty !== false), { encoding: "utf8", flag: "wx" });
    const published = publishBackup(tmp, dir, kind, { ...info, counts, schemaVersion: null });
    return { ...published, records, counts };
  } catch (err) {
    fs.rmSync(/* turbopackIgnore: true */ tmp, { force: true });
    throw err;
  }
}
