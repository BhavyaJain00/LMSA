import type { ChangeSet, RawData } from "./sqlite-core.mjs";

export type { ChangeSet, RawData };

export type DriverKind = "json" | "sqlite" | "postgres";

/** A value, or a promise of it (asynchronous drivers return promises where synchronous ones do not). */
export type MaybePromise<T> = T | Promise<T>;

/** How a storage file came to hold its data on first open. */
export type OpenOrigin = "existing" | "imported-json" | "imported-sqlite" | "seeded";

export interface OpenResult {
  data: RawData;
  origin: OpenOrigin;
}

/** Everything the admin data page shows about the storage. */
export interface StorageInfo {
  driver: DriverKind;
  /** Main file (db.json or the .sqlite file); for PostgreSQL the connection target without credentials. */
  file: string;
  /** Size of the main file plus SQLite's -wal/-shm companions (PostgreSQL: the tables and their indexes). */
  sizeBytes: number | null;
  walBytes: number | null;
  modifiedAt: string | null;
  sqliteVersion: string | null;
  schemaVersion: number | null;
  meta: Record<string, string>;
  /** Database server version (PostgreSQL only), e.g. "PostgreSQL 16.4". */
  serverVersion?: string | null;
}

/**
 * One storage backend for the store (see `engine.ts`). Every driver loads
 * the whole database into memory; they differ in how changes reach storage:
 *
 *  - `json`: `persist()` rewrites the whole file (the original behaviour);
 *  - `sqlite`: `persist()` applies a change set (per-document upserts and
 *    deletes in one transaction), synchronously;
 *  - `postgres`: `persist()` applies a change set in one transaction over
 *    the network, so it (and the other storage calls) return promises
 *    (`asynchronous`). The engine then runs every write and reload through
 *    its queue so they never overlap.
 */
export interface StoreDriver {
  readonly kind: DriverKind;
  /** True when `persist()` consumes change sets. */
  readonly incremental: boolean;
  /**
   * True when the storage calls (`persist`, `hasExternalChanges`, `reload`,
   * `checkIntegrity`, `close`) return promises. Synchronous drivers keep
   * their synchronous behaviour (the SQLite driver writes its last changes
   * from a `process.on("exit")` handler).
   */
  readonly asynchronous?: boolean;
  /** Folder for backups of this storage. */
  readonly backupsDir: string;
  /**
   * Open the storage and read everything. When it is empty the driver
   * imports the legacy JSON file (sqlite), the SQLite file or JSON file
   * (postgres) or stores `initialData()`.
   */
  open(initialData: () => Promise<RawData>): Promise<OpenResult>;
  /** Store changes. `changes` is null for the JSON driver (it writes `data` whole). */
  persist(data: RawData, changes: ChangeSet | null): MaybePromise<void>;
  /** Replace everything with `data` atomically. */
  replaceAll(data: RawData, source: string): MaybePromise<void>;
  /** True when another process changed the storage since the last check. */
  hasExternalChanges(): MaybePromise<boolean>;
  /** Read everything again (after an external change). */
  reload(): MaybePromise<RawData>;
  /**
   * Write a consistent copy to `target` (which must not exist). `data` is the
   * in-memory state, used by drivers that cannot copy the file itself.
   */
  backupTo(target: string, data: RawData): MaybePromise<void>;
  /** Create storage for collections added while running (development hot reload). */
  addCollections?(names: readonly string[]): void;
  /** Integrity check of the live storage. */
  checkIntegrity(mode: "quick" | "full"): MaybePromise<{ ok: boolean; messages: string[] }>;
  /** Cheap connectivity check (network databases; used by /api/health). */
  ping?(): Promise<void>;
  info(): StorageInfo;
  close(): MaybePromise<void>;
}

/** Run `fn` on `value` right away when it is not a promise, after it resolves otherwise. */
export function after<T, U>(value: T | Promise<T>, fn: (value: T) => U | Promise<U>): U | Promise<U> {
  return value instanceof Promise ? value.then(fn) : fn(value);
}
