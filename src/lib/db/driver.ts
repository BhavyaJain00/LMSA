import type { ChangeSet, RawData } from "./sqlite-core.mjs";

export type { ChangeSet, RawData };

export type DriverKind = "json" | "sqlite";

/** How a storage file came to hold its data on first open. */
export type OpenOrigin = "existing" | "imported-json" | "seeded";

export interface OpenResult {
  data: RawData;
  origin: OpenOrigin;
}

/** Everything the admin data page shows about the storage. */
export interface StorageInfo {
  driver: DriverKind;
  /** Main file (db.json or the .sqlite file). */
  file: string;
  /** Size of the main file plus SQLite's -wal/-shm companions. */
  sizeBytes: number | null;
  walBytes: number | null;
  modifiedAt: string | null;
  sqliteVersion: string | null;
  schemaVersion: number | null;
  meta: Record<string, string>;
}

/**
 * One storage backend for the store (see `engine.ts`). Both drivers load the
 * whole database into memory; they differ in how changes reach the disk:
 *
 *  - `json`: `persist()` rewrites the whole file (the original behaviour);
 *  - `sqlite`: `persist()` applies a change set (per-document upserts and
 *    deletes in one transaction), synchronously.
 */
export interface StoreDriver {
  readonly kind: DriverKind;
  /** True when `persist()` consumes change sets and runs synchronously. */
  readonly incremental: boolean;
  /** Folder for backups of this storage. */
  readonly backupsDir: string;
  /**
   * Open the storage and read everything. When it is empty the driver
   * imports the legacy JSON file (sqlite) or stores `initialData()`.
   */
  open(initialData: () => Promise<RawData>): Promise<OpenResult>;
  /** Store changes. `changes` is null for the JSON driver (it writes `data` whole). */
  persist(data: RawData, changes: ChangeSet | null): void | Promise<void>;
  /** Replace everything with `data` atomically. */
  replaceAll(data: RawData, source: string): void | Promise<void>;
  /** True when another process changed the storage since the last check. */
  hasExternalChanges(): boolean;
  /** Read everything again (after an external change). */
  reload(): RawData;
  /**
   * Write a consistent copy to `target` (which must not exist). `data` is the
   * in-memory state, used by drivers that cannot copy the file itself.
   */
  backupTo(target: string, data: RawData): void | Promise<void>;
  /** Create storage for collections added while running (development hot reload). */
  addCollections?(names: readonly string[]): void;
  /** Integrity check of the live storage. */
  checkIntegrity(mode: "quick" | "full"): { ok: boolean; messages: string[] };
  info(): StorageInfo;
  close(): void;
}
