import "server-only";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { StoreEngine, EngineStats } from "./engine";
import type { StorageInfo } from "./driver";
import { getStoreEngine } from "./store";
import {
  backupFileName,
  countDocuments,
  deleteBackupFile,
  inspectBackupFile,
  listBackupFiles,
  rawDataToJson,
  readBackupData,
  type BackupEntry,
  type BackupFormat,
  type BackupKind,
  type RawData,
} from "./data-core.mjs";
import {
  automaticBackupState,
  automaticBackupsEnabled,
  checkRestorable,
  getBackupEntry,
  publishBackup,
  removeStaleTempFiles,
  retentionFor,
  tempBackupPath,
} from "./backup-core.mjs";

/**
 * Backups and restore for the running app.
 *
 *  - Backups are JSON exports of the whole database (every collection and
 *    the settings), written from the in-memory state after every pending
 *    change has reached PostgreSQL. Every backup gets a manifest with its
 *    row counts. Supabase keeps its own database backups as well on paid plans (daily;
 *    point-in-time recovery on paid plans).
 *  - Daily automatic backup: `runScheduledBackup()` is started by the store
 *    on the first request of each local day; the day's file name is unique,
 *    so restarts and hot reloads never make a second one. The newest 14 are
 *    kept (DB_BACKUP_KEEP), safety backups 10, uploads 5, manual backups
 *    until deleted.
 *  - Restore: the backup is validated, the current data is saved as a
 *    "safety" backup, then everything is replaced in one PostgreSQL
 *    transaction and the in-memory cache is swapped — all while no other
 *    mutation runs.
 *
 * The command-line equivalents are `scripts/db-*.mjs` (`npm run db:backup`, `db:restore`).
 */

export type { BackupFormat, BackupKind };

export type BackupErrorCode = "not-found" | "invalid" | "busy" | "too-large" | "failed";

/** A backup operation failed for a reason worth showing to the administrator as is. */
export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

/** One backup as shown on the admin page (plain data: safe to pass to Client Components). */
export interface BackupInfo {
  name: string;
  kind: BackupKind;
  format: BackupFormat;
  createdAt: string;
  sizeBytes: number;
  /** Total documents; null when the backup has no manifest (a file copied into the folder by hand). */
  records: number | null;
  counts: Record<string, number> | null;
  schemaVersion: number | null;
  reason?: string;
  createdBy?: string;
  originalName?: string;
}

export interface RestorePreview {
  backup: BackupInfo;
  /** Documents per collection in the backup and in the live database. */
  backupCounts: Record<string, number>;
  currentCounts: Record<string, number>;
  backupRecords: number;
  currentRecords: number;
  /** Reasons the backup cannot be restored (empty when it can). */
  errors: string[];
  warnings: string[];
}

export interface RestoreResult {
  restored: BackupInfo;
  /** The copy of the data as it was just before the restore. */
  safety: BackupInfo;
  records: number;
  counts: Record<string, number>;
  warnings: string[];
}

export interface StorageOverview {
  info: StorageInfo;
  stats: EngineStats;
  backupsDir: string;
  counts: Record<string, number>;
  records: number;
  backups: BackupInfo[];
  automatic: {
    enabled: boolean;
    keep: number;
    /** Newest automatic backup on disk. */
    lastBackupAt: string | null;
    lastError: { message: string; at: string } | null;
  };
}

export interface IntegrityReport {
  ok: boolean;
  mode: "quick" | "full";
  messages: string[];
  ms: number;
}

/** Largest backup file an administrator can upload (the whole database is held in memory anyway). */
export const MAX_BACKUP_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;

const MAX_ORIGINAL_NAME = 120;

function toInfo(entry: BackupEntry): BackupInfo {
  const manifest = entry.manifest;
  const info: BackupInfo = {
    name: entry.name,
    kind: entry.kind,
    format: entry.format,
    createdAt: entry.createdAt,
    sizeBytes: entry.sizeBytes,
    records: manifest?.records ?? null,
    counts: manifest?.counts ?? null,
    schemaVersion: manifest?.schemaVersion ?? null,
  };
  if (manifest?.reason) info.reason = manifest.reason;
  if (manifest?.createdBy) info.createdBy = manifest.createdBy;
  if (manifest?.originalName) info.originalName = manifest.originalName;
  return info;
}

/** A file name safe to store and show: no path, no control characters, bounded length. */
export function cleanOriginalName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean === "." || clean === "..") return undefined;
  return clean.length > MAX_ORIGINAL_NAME ? clean.slice(0, MAX_ORIGINAL_NAME) : clean;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Errors administrators can act on keep their message; file system errors get an explanation. */
function explain(err: unknown, action: string): BackupError {
  if (err instanceof BackupError) return err;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOSPC") return new BackupError("failed", `Could not ${action}: the disk is full.`);
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new BackupError("failed", `Could not ${action}: the server is not allowed to write to the backups folder.`);
  }
  return new BackupError("failed", `Could not ${action}: ${messageOf(err)}`);
}

export class BackupManager {
  constructor(private readonly engine: StoreEngine) {}

  /** Folder holding this database's backups (`storage/backups` by default). */
  get dir(): string {
    return this.engine.driver.backupsDir;
  }

  /** Format of the backups (JSON exports). */
  get format(): BackupFormat {
    return "json";
  }

  /** Every backup in the folder, newest first. */
  list(): BackupInfo[] {
    return listBackupFiles(this.dir).map(toInfo);
  }

  /** The backup called `name`, or null (also for anything that is not a backup file name). */
  find(name: unknown): BackupEntry | null {
    return getBackupEntry(this.dir, name);
  }

  /** Snapshot the current data into the backups folder. */
  async create(options: { kind: BackupKind; reason?: string; createdBy?: string; date?: Date; protect?: readonly string[] }): Promise<BackupInfo> {
    await this.engine.getDb();
    // Everything in memory reaches the storage first, so the snapshot is complete. It is compared
    // in short slices (settle(), not flush()), so a large database does not stall other requests.
    await this.engine.settle();
    return this.write(options);
  }

  /**
   * The daily backup. Does nothing when DB_AUTO_BACKUP is off or today's
   * backup already exists; concurrent calls share one run.
   */
  async runAutomatic(now: Date = new Date()): Promise<BackupInfo | null> {
    if (!automaticBackupsEnabled()) return null;
    const state = automaticBackupState();
    if (state.running) return state.running as Promise<BackupInfo | null>;
    if (fs.existsSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ this.dir, backupFileName("auto", now)))) return null;
    const run = (async () => {
      try {
        const info = await this.create({ kind: "auto", date: now, reason: "Daily automatic backup" });
        state.lastRunAt = new Date().toISOString();
        state.lastError = null;
        return info;
      } catch (err) {
        state.lastError = { message: messageOf(err), at: new Date().toISOString() };
        throw err;
      } finally {
        state.running = null;
      }
    })();
    state.running = run;
    return run;
  }

  /** Delete backups by name. Returns the names that were deleted. */
  delete(names: readonly string[]): string[] {
    const deleted: string[] = [];
    for (const name of new Set(names)) {
      const entry = this.find(name);
      if (!entry) continue;
      try {
        deleteBackupFile(entry.file);
      } catch (err) {
        throw explain(err, `delete ${entry.name}`);
      }
      deleted.push(entry.name);
    }
    return deleted;
  }

  /**
   * Write the current data as a JSON export to a temporary file for a
   * direct download. The caller streams the file and removes it afterwards.
   */
  async exportTo(): Promise<{ file: string; sizeBytes: number }> {
    await this.engine.getDb();
    removeStaleTempFiles(this.dir);
    const tmp = tempBackupPath(this.dir, "json");
    try {
      await fsp.writeFile(/* turbopackIgnore: true */ tmp, rawDataToJson(this.engine.snapshot()!), { encoding: "utf8", flag: "wx" });
      return { file: tmp, sizeBytes: (await fsp.stat(/* turbopackIgnore: true */ tmp)).size };
    } catch (err) {
      fs.rmSync(/* turbopackIgnore: true */ tmp, { force: true });
      throw explain(err, "export the database");
    }
  }

  /**
   * Store an uploaded backup file (a JSON export) after checking that it
   * really is one: it must parse into collections of documents with ids.
   * Nothing is restored yet.
   */
  async receiveUpload(
    body: ReadableStream<Uint8Array>,
    options: { originalName?: string | null; createdBy?: string; maxBytes?: number } = {},
  ): Promise<BackupInfo> {
    const maxBytes = options.maxBytes ?? MAX_BACKUP_UPLOAD_BYTES;
    removeStaleTempFiles(this.dir);
    const tmp = tempBackupPath(this.dir, "part");
    try {
      let size = 0;
      const handle = await fsp.open(/* turbopackIgnore: true */ tmp, "wx");
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new BackupError("too-large", `This file is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit for backups.`);
          }
          await handle.write(value);
        }
      } finally {
        await handle.close();
      }
      if (size === 0) throw new BackupError("invalid", "The uploaded file is empty.");

      let summary: ReturnType<typeof inspectBackupFile>;
      try {
        summary = inspectBackupFile(tmp);
      } catch (err) {
        throw new BackupError("invalid", messageOf(err));
      }
      const { entry } = publishBackup(tmp, this.dir, "upload", {
        counts: summary.counts,
        schemaVersion: summary.schemaVersion,
        createdBy: options.createdBy,
        originalName: cleanOriginalName(options.originalName),
        reason: "Uploaded for restore",
      });
      return toInfo(entry);
    } catch (err) {
      fs.rmSync(/* turbopackIgnore: true */ tmp, { force: true });
      throw explain(err, "store the uploaded backup");
    }
  }

  /** What restoring `name` would do: counts side by side, blockers and warnings. */
  async preview(name: string): Promise<RestorePreview> {
    const entry = this.require(name);
    const data = this.read(entry);
    await this.engine.getDb();
    const check = checkRestorable(data, this.engine.collectionNames());
    const backup = countDocuments(data);
    const current = countDocuments(this.engine.snapshot()!);
    return {
      backup: toInfo(entry),
      backupCounts: backup.counts,
      currentCounts: current.counts,
      backupRecords: backup.records,
      currentRecords: current.records,
      errors: check.errors,
      warnings: check.warnings,
    };
  }

  /**
   * Replace the whole database with the backup called `name`.
   *
   * Runs with the store to itself: pending changes are written, the current
   * data is saved as a safety backup, then the driver replaces everything
   * atomically (one PostgreSQL transaction) and the cache is swapped. If any
   * step fails the live data is untouched.
   */
  async restore(name: string, options: { createdBy?: string } = {}): Promise<RestoreResult> {
    const entry = this.require(name);
    const data = this.read(entry);
    const check = checkRestorable(data, this.engine.collectionNames());
    if (check.errors.length) throw new BackupError("invalid", check.errors[0]!);
    const { counts, records } = countDocuments(data);
    try {
      const safety = await this.engine.exclusive(async (ctx) => {
        const saved = await this.write({
          kind: "safety",
          reason: `Before restoring ${entry.name}`,
          createdBy: options.createdBy,
          protect: [entry.name],
        });
        await ctx.replaceAll(data, `restore:${entry.name}`);
        return saved;
      });
      return { restored: toInfo(entry), safety, records, counts, warnings: check.warnings };
    } catch (err) {
      throw explain(err, "restore the backup");
    }
  }

  /**
   * Replace the whole database with `data` (the demo data reset), keeping
   * the current contents as a safety backup. The backup and the replacement
   * run in one exclusive section, like `restore()`: no change can be made
   * after the backup is taken and then be discarded by the replacement.
   */
  async replaceWith(data: RawData, options: { source: string; reason: string; createdBy?: string }): Promise<BackupInfo> {
    try {
      return await this.engine.exclusive(async (ctx) => {
        const saved = await this.write({ kind: "safety", reason: options.reason, createdBy: options.createdBy });
        await ctx.replaceAll(data, options.source);
        return saved;
      });
    } catch (err) {
      throw explain(err, "replace the data");
    }
  }

  /**
   * Quick: the database answers, every table exists and its rows can be
   * counted. Full: also that every row's id and indexed columns match its
   * document.
   */
  async checkIntegrity(mode: "quick" | "full"): Promise<IntegrityReport> {
    const started = performance.now();
    try {
      const result = await this.engine.driver.checkIntegrity(mode);
      return { ok: result.ok, mode, messages: result.ok ? [] : result.messages.slice(0, 20), ms: Math.round(performance.now() - started) };
    } catch (err) {
      return { ok: false, mode, messages: [messageOf(err)], ms: Math.round(performance.now() - started) };
    }
  }

  /** Everything the admin data page shows. */
  async overview(): Promise<StorageOverview> {
    await this.engine.getDb();
    const backups = this.list();
    const { counts, records } = countDocuments(this.engine.snapshot()!);
    return {
      info: this.engine.driver.info(),
      stats: this.engine.getStats(),
      backupsDir: this.dir,
      counts,
      records,
      backups,
      automatic: {
        enabled: automaticBackupsEnabled(),
        keep: retentionFor("auto") ?? 0,
        lastBackupAt: backups.find((b) => b.kind === "auto")?.createdAt ?? null,
        lastError: automaticBackupState().lastError,
      },
    };
  }

  private require(name: string): BackupEntry {
    const entry = this.find(name);
    if (!entry) throw new BackupError("not-found", "That backup no longer exists. Reload the page to see the current list.");
    return entry;
  }

  private read(entry: BackupEntry): RawData {
    try {
      return readBackupData(entry.file).data;
    } catch (err) {
      throw new BackupError("invalid", messageOf(err));
    }
  }

  /** Write the current data (settled by the caller) as a JSON backup of `kind`. */
  private async write(options: { kind: BackupKind; reason?: string; createdBy?: string; date?: Date; protect?: readonly string[] }): Promise<BackupInfo> {
    removeStaleTempFiles(this.dir);
    const tmp = tempBackupPath(this.dir, "json");
    try {
      const data = this.engine.snapshot()!;
      await this.engine.driver.backupTo(tmp, data);
      const { entry } = publishBackup(tmp, this.dir, options.kind, {
        date: options.date,
        reason: options.reason,
        createdBy: options.createdBy,
        counts: countDocuments(data).counts,
        schemaVersion: null,
        protect: options.protect,
      });
      return toInfo(entry);
    } catch (err) {
      fs.rmSync(/* turbopackIgnore: true */ tmp, { force: true });
      throw explain(err, "create the backup");
    }
  }
}

/** A failed daily backup is tried again after this long (instead of the next day). */
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

/** Backups of the app's own database. */
export async function getBackupManager(): Promise<BackupManager> {
  return new BackupManager(await getStoreEngine());
}

/**
 * Entry point of the daily backup (called by the store on the first request
 * of each local day). Never throws: a failure is logged, shown on the admin
 * data page, recorded in the error log (which alerts administrators) and
 * tried again an hour later.
 */
export async function runScheduledBackup(): Promise<void> {
  try {
    const manager = await getBackupManager();
    const info = await manager.runAutomatic();
    if (info) console.info(`[backup] daily backup written: ${info.name} (${info.records ?? 0} records).`);
  } catch (err) {
    const message = messageOf(err);
    console.error("[backup] the daily backup failed:", message);
    const state = automaticBackupState();
    state.lastError ??= { message, at: new Date().toISOString() };
    state.nextCheckAt = Date.now() + RETRY_AFTER_FAILURE_MS;
    try {
      const { recordError } = await import("@/lib/errors/record");
      await recordError({ message: `The daily database backup failed: ${message}`, path: "/admin/settings/data", method: "JOB" });
    } catch {
      // The error log is a courtesy; the console line above is the record of last resort.
    }
  }
}
