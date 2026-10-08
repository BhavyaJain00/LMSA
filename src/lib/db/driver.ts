import type { ChangeSet, RawData } from "./data-core.mjs";

export type { ChangeSet, RawData };

/** `postgres` is the app's database; `memory` exists only in test runs (`tests/helpers/memory-driver.ts`). */
export type DriverKind = "postgres" | "memory";

/** A value, or a promise of it (asynchronous drivers return promises where synchronous ones do not). */
export type MaybePromise<T> = T | Promise<T>;

/** Whether the database already held data on first open, or was just seeded. */
export type OpenOrigin = "existing" | "seeded";

export interface OpenResult {
  data: RawData;
  origin: OpenOrigin;
}

/** Everything the admin data page shows about the storage. */
export interface StorageInfo {
  driver: DriverKind;
  /** The connection target without credentials (host, port, database, schema). */
  target: string;
  /** Size of the tables and their indexes. */
  sizeBytes: number | null;
  modifiedAt: string | null;
  /** Applied schema migrations. */
  schemaVersion: number | null;
  meta: Record<string, string>;
  /** Database server version, e.g. "PostgreSQL 16.4". */
  serverVersion?: string | null;
}

/**
 * One storage backend for the store (see `engine.ts`). The driver loads the
 * whole database into memory and `persist()` applies the change sets the
 * engine computes (per-document upserts and deletes in one transaction).
 *
 * PostgreSQL is reached over the network, so its storage calls return
 * promises (`asynchronous`); the engine then runs every write and reload
 * through its queue so they never overlap. The engine also supports
 * synchronous drivers (the in-memory test driver can be either).
 */
export interface StoreDriver {
  readonly kind: DriverKind;
  /** True when `persist()` consumes change sets (every current driver). */
  readonly incremental: boolean;
  /**
   * True when the storage calls (`persist`, `hasExternalChanges`, `reload`,
   * `checkIntegrity`, `close`) return promises. A synchronous driver writes
   * its last changes from a `process.on("exit")` handler.
   */
  readonly asynchronous?: boolean;
  /** Folder for backups (JSON exports). */
  readonly backupsDir: string;
  /** Open the storage and read everything. When it is empty the driver stores `initialData()` first. */
  open(initialData: () => Promise<RawData>): Promise<OpenResult>;
  /** Store changes (`changes` is null only for drivers that are not `incremental`: they write `data` whole). */
  persist(data: RawData, changes: ChangeSet | null): MaybePromise<void>;
  /** Replace everything with `data` atomically. */
  replaceAll(data: RawData, source: string): MaybePromise<void>;
  /** True when another process changed the storage since the last check. */
  hasExternalChanges(): MaybePromise<boolean>;
  /** Read everything again (after an external change). */
  reload(): MaybePromise<RawData>;
  /** Write a JSON export of `data` (the settled in-memory state) to `target`, which must not exist. */
  backupTo(target: string, data: RawData): MaybePromise<void>;
  /** Create storage for collections added while running (development hot reload). */
  addCollections?(names: readonly string[]): void;
  /** Integrity check of the live storage. */
  checkIntegrity(mode: "quick" | "full"): MaybePromise<{ ok: boolean; messages: string[] }>;
  /** Cheap connectivity check (used by /api/health). */
  ping?(): Promise<void>;
  info(): StorageInfo;
  close(): MaybePromise<void>;
}

/** Run `fn` on `value` right away when it is not a promise, after it resolves otherwise. */
export function after<T, U>(value: T | Promise<T>, fn: (value: T) => U | Promise<U>): U | Promise<U> {
  return value instanceof Promise ? value.then(fn) : fn(value);
}
