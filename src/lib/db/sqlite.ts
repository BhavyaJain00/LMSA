import fs from "node:fs";
import path from "node:path";
import {
  applyChanges,
  backupsDirFor,
  checkIntegrity,
  countRows,
  ensureCollectionTables,
  getMeta,
  isBusyError,
  isCorruptionError,
  isInitialized,
  listBackupFiles,
  migrate,
  openDatabase,
  readAllData,
  readJsonFile,
  readMeta,
  setMeta,
  sqliteVersion,
  transaction,
  vacuumInto,
  writeAllData,
  type ChangeSet,
  type RawData,
  type SqliteConnection,
} from "./sqlite-core.mjs";
import type { OpenResult, StorageInfo, StoreDriver } from "./driver";

export interface SqliteDriverOptions {
  /** The .sqlite file. */
  file: string;
  /** Collection names; a table is created for each one that is missing. */
  collections: readonly string[];
  /** Legacy JSON database imported when the SQLite file is empty (DATA_FILE). */
  legacyJsonFile?: string;
  /**
   * The in-memory contents of a JSON store that was running in this process
   * before a hot reload switched drivers; preferred over the file because it
   * may hold changes that were not written yet.
   */
  legacySnapshot?: () => RawData | null;
  /** How long a write waits for another process's lock (default 5 s; tests shorten it). */
  busyTimeoutMs?: number;
}

/**
 * Thrown when the database cannot be used: the startup integrity check
 * failed, or SQLite cannot read the file at all. The message says how to
 * get back to a working site.
 */
export class DatabaseCorruptedError extends Error {
  constructor(file: string, messages: string[], backupsDir: string) {
    const latest = safeLatestBackup(backupsDir);
    super(
      [
        `The database file ${file} failed its integrity check: ${messages.slice(0, 3).join("; ")}.`,
        "Stop the app, then restore the most recent backup:",
        latest ? `  npm run db:restore -- "${latest}"` : `  npm run db:restore -- <file from ${backupsDir}>`,
        "The restore keeps the damaged file next to the database as <name>.damaged-<timestamp>.",
        "To start with an empty database instead, move the damaged file (and its -wal/-shm files) aside yourself.",
      ].join("\n"),
    );
    this.name = "DatabaseCorruptedError";
  }
}

/** Thrown when another process holds the database's write lock for longer than the busy timeout. */
export class DatabaseLockedError extends Error {
  constructor(file: string, action: string) {
    super(
      `Could not ${action}: ${file} is locked by another process. Only one app process may use the database at a time; ` +
        "if a backup or restore script is running, wait for it to finish and try again.",
    );
    this.name = "DatabaseLockedError";
  }
}

function safeLatestBackup(dir: string): string | null {
  try {
    return listBackupFiles(dir).find((b) => b.format === "sqlite")?.file ?? null;
  } catch {
    return null;
  }
}

/**
 * SQLite storage through the built-in `node:sqlite` module: one table per
 * collection, per-document upserts in transactions, WAL journal.
 * All calls are synchronous (DatabaseSync), which lets the store write its
 * last changes from a `process.on("exit")` handler.
 */
export class SqliteDriver implements StoreDriver {
  readonly kind = "sqlite" as const;
  readonly incremental = true;
  readonly backupsDir: string;
  private conn: SqliteConnection | null = null;
  private dataVersion = 0;
  private readonly collections: string[];

  constructor(private readonly options: SqliteDriverOptions) {
    this.backupsDir = backupsDirFor(options.file);
    this.collections = [...options.collections];
  }

  get file(): string {
    return this.options.file;
  }

  /**
   * Read the database. An empty file is filled first, in one transaction:
   * from the legacy JSON database when there is one (which is then renamed
   * to `<name>.migrated-<timestamp>`, never deleted), otherwise from
   * `initialData()` (demo seed or bootstrap admin).
   */
  async open(initialData: () => Promise<RawData>): Promise<OpenResult> {
    const conn = this.connect();
    if (this.guarded("open the database", () => isInitialized(conn))) {
      this.warnAboutIgnoredLegacyFile();
      return { data: this.readEverything(conn), origin: "existing" };
    }

    const legacy = this.readLegacyJson();
    if (legacy) {
      const imported = this.initializeWith(legacy.data, `json:${legacy.source}`);
      const data = this.readEverything(conn);
      if (imported) {
        this.reportImport(legacy.data, legacy.source);
        if (legacy.file) this.archiveLegacyFile(legacy.file);
      }
      return { data, origin: imported ? "imported-json" : "existing" };
    }

    const data = await initialData();
    const seeded = this.initializeWith(data, "seed");
    return { data: this.readEverything(conn), origin: seeded ? "seeded" : "existing" };
  }

  persist(_data: RawData, changes: ChangeSet | null): void {
    if (!changes) return;
    applyChanges(this.connect(), changes);
  }

  replaceAll(data: RawData, source: string): void {
    this.guarded("replace the database contents", () => writeAllData(this.connect(), data, { source }));
  }

  hasExternalChanges(): boolean {
    const version = this.readDataVersion();
    if (version === this.dataVersion) return false;
    this.dataVersion = version;
    return true;
  }

  reload(): RawData {
    const data = this.readEverything(this.connect());
    this.dataVersion = this.readDataVersion();
    return data;
  }

  addCollections(names: readonly string[]): void {
    const added = names.filter((name) => !this.collections.includes(name));
    if (!added.length) return;
    this.collections.push(...added);
    if (this.conn) ensureCollectionTables(this.conn, added);
  }

  backupTo(target: string): void {
    vacuumInto(this.connect(), target);
  }

  checkIntegrity(mode: "quick" | "full"): { ok: boolean; messages: string[] } {
    return checkIntegrity(this.connect(), mode);
  }

  info(): StorageInfo {
    const file = this.options.file;
    const size = (f: string) => {
      try {
        return fs.statSync(f).size;
      } catch {
        return 0;
      }
    };
    let modifiedAt: string | null = null;
    try {
      const stat = fs.statSync(fs.existsSync(`${file}-wal`) ? `${file}-wal` : file);
      modifiedAt = stat.mtime.toISOString();
    } catch {
      // Not created yet.
    }
    const meta = this.conn ? readMeta(this.conn) : {};
    const main = size(file);
    const wal = size(`${file}-wal`);
    return {
      driver: "sqlite",
      file,
      sizeBytes: main || wal ? main + wal + size(`${file}-shm`) : null,
      walBytes: wal,
      modifiedAt,
      sqliteVersion: sqliteVersion(),
      schemaVersion: meta.schema_version ? Number(meta.schema_version) : null,
      meta,
    };
  }

  close(): void {
    if (!this.conn) return;
    try {
      // Fold the WAL back into the main file so a copied .sqlite is complete.
      this.conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // Another process may be reading; the WAL is kept and replayed later.
    }
    this.conn.close();
    this.conn = null;
  }

  /**
   * Open the connection on first use: pragmas, `PRAGMA quick_check`,
   * migrations. A file that fails the check, or that SQLite cannot read at
   * all, stops the start with restore instructions instead of serving
   * half-readable data.
   */
  private connect(): SqliteConnection {
    if (this.conn) return this.conn;
    let conn: SqliteConnection | null = null;
    try {
      conn = openDatabase(this.options.file, { busyTimeoutMs: this.options.busyTimeoutMs });
      const integrity = checkIntegrity(conn, "quick");
      if (!integrity.ok) throw new DatabaseCorruptedError(this.options.file, integrity.messages, this.backupsDir);
      const result = migrate(conn, this.collections);
      if (result.applied.length && result.from > 0) {
        console.info(`[db] migrated ${this.options.file} from schema ${result.from} to ${result.to}: ${result.applied.join(", ")}`);
      }
    } catch (err) {
      conn?.close();
      throw this.explain("open the database", err);
    }
    this.conn = conn;
    this.dataVersion = this.readDataVersion();
    return conn;
  }

  /** Turn SQLite's corruption and lock errors into errors that say what to do. */
  private explain(action: string, err: unknown): unknown {
    if (err instanceof DatabaseCorruptedError || err instanceof DatabaseLockedError) return err;
    if (isCorruptionError(err)) return new DatabaseCorruptedError(this.options.file, [err instanceof Error ? err.message : String(err)], this.backupsDir);
    if (isBusyError(err)) return new DatabaseLockedError(this.options.file, action);
    return err;
  }

  private guarded<T>(action: string, fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      throw this.explain(action, err);
    }
  }

  private readEverything(conn: SqliteConnection): RawData {
    return this.guarded("read the database", () => readAllData(conn, this.collections));
  }

  private readDataVersion(): number {
    return Number(this.connect().prepare("PRAGMA data_version").get()?.data_version ?? 0);
  }

  /**
   * Store the first contents in one transaction. Returns false when another
   * process initialized the file first (its data wins; ours is discarded).
   */
  private initializeWith(data: RawData, source: string): boolean {
    return this.guarded("create the database", () => writeAllData(this.connect(), data, { source, initialize: true }));
  }

  private readLegacyJson(): { data: RawData; source: string; file: string | null } | null {
    const snapshot = this.options.legacySnapshot?.();
    const file = this.options.legacyJsonFile;
    if (snapshot) return { data: snapshot, source: "memory", file: file && fs.existsSync(file) ? file : null };
    if (!file || !fs.existsSync(file)) return null;
    try {
      return { data: readJsonFile(file), source: path.basename(file), file };
    } catch (err) {
      throw new Error(
        `Could not import ${file} into SQLite: ${err instanceof Error ? err.message : String(err)}. Fix or move the file, or set DB_DRIVER=json to keep using it.`,
      );
    }
  }

  /**
   * Log what the import stored and anything it could not keep: the table
   * holds one row per id, so later copies of a repeated id are left out
   * (they remain in the archived JSON file).
   */
  private reportImport(source: RawData, label: string): void {
    const counts = countRows(this.connect());
    let documents = 0;
    const dropped: string[] = [];
    for (const [name, docs] of Object.entries(source.collections)) {
      const stored = counts[name] ?? 0;
      documents += stored;
      if (stored < docs.length) dropped.push(`${name} (${docs.length - stored})`);
    }
    console.info(`[db] imported ${documents} document(s) from ${label} into ${this.options.file}.`);
    if (dropped.length) {
      console.warn(`[db] the import skipped documents whose id was already used by an earlier document in the same collection: ${dropped.join(", ")}.`);
    }
  }

  /**
   * Rename the imported JSON file so it is not imported twice. It is never
   * deleted or overwritten; the new name is recorded in `meta`.
   */
  private archiveLegacyFile(file: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = `${file}.migrated-${stamp}`;
    for (let n = 2; fs.existsSync(target); n++) target = `${file}.migrated-${stamp}-${n}`;
    try {
      fs.renameSync(file, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      console.warn(`[db] ${file} was imported but could not be renamed (${(err as Error).message}). It is ignored from now on because the SQLite database holds the data; rename or move it yourself.`);
      return;
    }
    console.info(`[db] the JSON file was kept as ${target}.`);
    this.setMeta("legacy_json_archive", path.basename(target));
  }

  /** A JSON database next to an initialized SQLite file is never read: say so once instead of ignoring it silently. */
  private warnAboutIgnoredLegacyFile(): void {
    const file = this.options.legacyJsonFile;
    if (!file || !fs.existsSync(file)) return;
    console.warn(
      `[db] ${file} exists but is not used: ${this.options.file} already holds the data. Rename or remove the JSON file, or load it with "npm run db:restore -- ${file}" to replace the SQLite data with it.`,
    );
  }

  /** The `meta` value for `key` (used by the backup scheduler). */
  getMeta(key: string): string | null {
    return getMeta(this.connect(), key);
  }

  setMeta(key: string, value: string): void {
    const conn = this.connect();
    transaction(conn, () => setMeta(conn, key, value));
  }
}
