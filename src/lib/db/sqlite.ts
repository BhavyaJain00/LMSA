import fs from "node:fs";
import path from "node:path";
import {
  applyChanges,
  backupsDirFor,
  checkIntegrity,
  ensureCollectionTables,
  getMeta,
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
}

/** Thrown when the startup integrity check fails. */
export class DatabaseCorruptedError extends Error {
  constructor(file: string, messages: string[], backupsDir: string) {
    const latest = safeLatestBackup(backupsDir);
    super(
      [
        `The database file ${file} failed its integrity check: ${messages.slice(0, 3).join("; ")}.`,
        "Stop the app, then restore the most recent backup:",
        latest ? `  npm run db:restore -- "${latest}"` : `  npm run db:restore -- <file from ${backupsDir}>`,
        "or move the damaged file (and its -wal/-shm files) aside to start with an empty database.",
      ].join("\n"),
    );
    this.name = "DatabaseCorruptedError";
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

  async open(initialData: () => Promise<RawData>): Promise<OpenResult> {
    const conn = this.connect();
    if (isInitialized(conn)) return { data: readAllData(conn, this.collections), origin: "existing" };

    const legacy = this.readLegacyJson();
    if (legacy) {
      const imported = this.initializeWith(legacy.data, `json:${legacy.source}`);
      if (imported && legacy.file) this.archiveLegacyFile(legacy.file);
      return { data: readAllData(conn, this.collections), origin: imported ? "imported-json" : "existing" };
    }

    const data = await initialData();
    const seeded = this.initializeWith(data, "seed");
    return { data: readAllData(conn, this.collections), origin: seeded ? "seeded" : "existing" };
  }

  persist(_data: RawData, changes: ChangeSet | null): void {
    if (!changes) return;
    applyChanges(this.connect(), changes);
  }

  replaceAll(data: RawData, source: string): void {
    writeAllData(this.connect(), data, { source });
  }

  hasExternalChanges(): boolean {
    const version = this.readDataVersion();
    if (version === this.dataVersion) return false;
    this.dataVersion = version;
    return true;
  }

  reload(): RawData {
    const conn = this.connect();
    const data = readAllData(conn, this.collections);
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

  /** Open the connection on first use: pragmas, integrity check, migrations. */
  private connect(): SqliteConnection {
    if (this.conn) return this.conn;
    const conn = openDatabase(this.options.file);
    try {
      const integrity = checkIntegrity(conn, "quick");
      if (!integrity.ok) throw new DatabaseCorruptedError(this.options.file, integrity.messages, this.backupsDir);
      const result = migrate(conn, this.collections);
      if (result.applied.length && result.from > 0) {
        console.info(`[db] migrated ${this.options.file} from schema ${result.from} to ${result.to}: ${result.applied.join(", ")}`);
      }
    } catch (err) {
      conn.close();
      throw err;
    }
    this.conn = conn;
    this.dataVersion = this.readDataVersion();
    return conn;
  }

  private readDataVersion(): number {
    return Number(this.connect().prepare("PRAGMA data_version").get()?.data_version ?? 0);
  }

  /**
   * Store the first contents in one transaction. Returns false when another
   * process initialized the file first (its data wins; ours is discarded).
   */
  private initializeWith(data: RawData, source: string): boolean {
    return writeAllData(this.connect(), data, { source, initialize: true });
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

  /** Rename the imported JSON file (never deleted) so it is not imported twice. */
  private archiveLegacyFile(file: string): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = `${file}.migrated-${stamp}`;
    try {
      fs.renameSync(file, target);
      console.info(`[db] imported ${file} into ${this.options.file}; the JSON file was kept as ${target}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      console.warn(`[db] imported ${file} but could not rename it (${(err as Error).message}); it will be ignored because the SQLite database is now initialized.`);
    }
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
