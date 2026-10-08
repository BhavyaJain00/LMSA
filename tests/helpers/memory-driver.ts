/**
 * An in-memory store driver for tests, so `npm test` needs no PostgreSQL.
 *
 * It behaves like the PostgreSQL driver where the store can tell: it is
 * incremental (applies the engine's change sets: upserts keep a document's
 * position, new documents go last, `order` renumbers), asynchronous by
 * default (the engine's production code path), keeps every document as a
 * JSON string (so nothing is shared with the cache), counts writes like
 * `meta.write_seq` (two drivers on one `MemoryDatabase` see each other's
 * writes as external changes) and seeds an uninitialized database with
 * `initialData()`.
 *
 * Only tests can select it: `installMemoryStore()` (called by
 * `tests/register.mjs`, and refusing unless NODE_ENV is "test") puts a hook
 * on `globalThis` that `src/lib/db/store.ts` honours. App code never imports
 * this file or installs the hook.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import type { OpenResult, RawData, StorageInfo, StoreDriver } from "@/lib/db/driver";
import type { ChangeSet } from "@/lib/db/data-core.mjs";
import { docId, rawDataToJson } from "@/lib/db/data-core.mjs";
import type { TestStoreHook } from "@/lib/db/store";

/** What a PostgreSQL database holds, in memory: one ordered map of JSON documents per collection. */
export class MemoryDatabase {
  readonly tables = new Map<string, Map<string, string>>();
  settings: string | null = null;
  /** False until the first contents are stored (a new PostgreSQL database). */
  initialized: boolean;
  /** Bumped by every write, like `meta.write_seq`. */
  seq = 0;
  meta: Record<string, string> = {};
  /** Set to make the next write fail (simulates a lost connection). */
  failNextWrite: Error | null = null;

  constructor(options: { initialized?: boolean } = {}) {
    this.initialized = options.initialized ?? false;
  }

  table(name: string): Map<string, string> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  /** Apply a change set (one "transaction"); returns the new write sequence. */
  apply(changes: ChangeSet): number {
    this.throwIfFailing();
    for (const change of changes.collections) {
      const table = this.table(change.name);
      for (const id of change.deletes) table.delete(id);
      for (const row of change.upserts) table.set(row.id, row.json);
      if (change.order) {
        const reordered = new Map<string, string>();
        for (const id of change.order) {
          const json = table.get(id);
          if (json !== undefined) reordered.set(id, json);
        }
        // Rows the order does not mention stay, after the ordered ones.
        for (const [id, json] of table) if (!reordered.has(id)) reordered.set(id, json);
        this.tables.set(change.name, reordered);
      }
    }
    if (changes.settings !== null) this.settings = changes.settings;
    return ++this.seq;
  }

  /** Replace everything with `data` (repeated ids keep their first copy). */
  replace(data: RawData, collections: readonly string[], source: string): number {
    this.throwIfFailing();
    const names = new Set([...collections, ...this.tables.keys()]);
    for (const name of names) {
      const table = new Map<string, string>();
      for (const doc of data.collections[name] ?? []) {
        const id = docId(doc);
        if (!id) throw new Error(`Collection "${name}" has a document without an id.`);
        if (!table.has(id)) table.set(id, JSON.stringify(doc));
      }
      this.tables.set(name, table);
    }
    this.settings = data.settings ? JSON.stringify(data.settings) : null;
    const now = new Date().toISOString();
    if (!this.initialized) {
      this.meta.initialized_at = now;
      this.meta.initialized_from = source;
    } else {
      this.meta.last_replaced_at = now;
      this.meta.last_replaced_from = source;
    }
    this.initialized = true;
    return ++this.seq;
  }

  /** Everything, parsed (fresh objects). */
  read(collections: readonly string[]): RawData {
    const out: Record<string, unknown[]> = {};
    for (const name of collections) out[name] = [...(this.tables.get(name)?.values() ?? [])].map((json) => JSON.parse(json));
    return { collections: out, settings: this.settings === null ? null : JSON.parse(this.settings) };
  }

  /** Documents per collection. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, table] of this.tables) out[name] = table.size;
    return out;
  }

  private throwIfFailing(): void {
    const err = this.failNextWrite;
    if (err) {
      this.failNextWrite = null;
      throw err;
    }
  }
}

export interface MemoryDriverOptions {
  database?: MemoryDatabase;
  collections: readonly string[];
  backupsDir: string;
  /** Default true, like PostgreSQL. */
  asynchronous?: boolean;
  /** Shown as the connection target. */
  target?: string;
}

export class MemoryDriver implements StoreDriver {
  readonly kind = "memory" as const;
  readonly incremental = true;
  readonly asynchronous: boolean;
  readonly backupsDir: string;
  readonly database: MemoryDatabase;
  private readonly collections: string[];
  private readonly target: string;
  private seq = 0;
  private external = false;
  private lastWriteAt: string | null = null;
  /** Calls to persist() that wrote something (for tests). */
  writes = 0;

  constructor(options: MemoryDriverOptions) {
    this.database = options.database ?? new MemoryDatabase();
    this.collections = [...options.collections];
    this.backupsDir = options.backupsDir;
    this.asynchronous = options.asynchronous ?? true;
    this.target = options.target ?? "memory";
  }

  async open(initialData: () => Promise<RawData>): Promise<OpenResult> {
    let origin: OpenResult["origin"] = "existing";
    if (!this.database.initialized) {
      this.database.replace(await initialData(), this.collections, "seed");
      origin = "seeded";
    }
    this.seq = this.database.seq;
    return { data: this.database.read(this.collections), origin };
  }

  persist(_data: RawData, changes: ChangeSet | null): void | Promise<void> {
    return this.maybeAsync(() => {
      if (!changes || (!changes.collections.length && changes.settings === null)) return;
      const seq = this.database.apply(changes);
      if (seq !== this.seq + 1) this.external = true;
      this.seq = seq;
      this.writes++;
      this.lastWriteAt = new Date().toISOString();
    });
  }

  replaceAll(data: RawData, source: string): void | Promise<void> {
    return this.maybeAsync(() => {
      this.seq = this.database.replace(data, this.collections, source);
      this.external = false;
      this.lastWriteAt = new Date().toISOString();
    });
  }

  hasExternalChanges(): boolean | Promise<boolean> {
    return this.maybeAsync(() => this.external || this.database.seq !== this.seq);
  }

  reload(): RawData | Promise<RawData> {
    return this.maybeAsync(() => {
      this.external = false;
      this.seq = this.database.seq;
      return this.database.read(this.collections);
    });
  }

  async backupTo(target: string, data: RawData): Promise<void> {
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, rawDataToJson(data), { encoding: "utf8", flag: "wx" });
  }

  addCollections(names: readonly string[]): void {
    for (const name of names) if (!this.collections.includes(name)) this.collections.push(name);
  }

  checkIntegrity(): { ok: boolean; messages: string[] } | Promise<{ ok: boolean; messages: string[] }> {
    return this.maybeAsync(() => ({ ok: true, messages: ["ok"] }));
  }

  async ping(): Promise<void> {}

  info(): StorageInfo {
    let sizeBytes = this.database.settings?.length ?? 0;
    for (const table of this.database.tables.values()) for (const json of table.values()) sizeBytes += json.length;
    return {
      driver: "memory",
      target: this.target,
      sizeBytes,
      modifiedAt: this.lastWriteAt,
      schemaVersion: null,
      meta: { ...this.database.meta, write_seq: String(this.database.seq) },
      serverVersion: null,
    };
  }

  close(): void {
    // Nothing held open.
  }

  /** Run `fn` now, and hand back its result as a promise when the driver is asynchronous. */
  private maybeAsync<T>(fn: () => T): T | Promise<T> {
    if (!this.asynchronous) return fn();
    try {
      return Promise.resolve(fn());
    } catch (err) {
      return Promise.reject(err);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The store's test database                                           */
/* ------------------------------------------------------------------ */

const g = globalThis as unknown as { __llTestStore?: TestStoreHook; __llTestMemory?: { database: MemoryDatabase; generation: number; driver: MemoryDriver | null } };

function state() {
  return (g.__llTestMemory ??= { database: new MemoryDatabase({ initialized: true }), generation: 1, driver: null });
}

/**
 * Point the store (`src/lib/db/store.ts`) at an in-memory database. Called
 * once per test process by `tests/register.mjs`. The database starts
 * initialized and empty (nothing is seeded unless a test asks for it).
 */
export function installMemoryStore(): void {
  if (process.env.NODE_ENV !== "test") throw new Error("The in-memory store driver is for test runs only (NODE_ENV=test).");
  g.__llTestStore = {
    testRun: true,
    target: () => `memory:${state().generation}`,
    create: ({ collections, backupsDir }) => {
      const current = state();
      current.driver = new MemoryDriver({ database: current.database, collections, backupsDir, target: `memory:${current.generation}` });
      return current.driver;
    },
  };
}

/**
 * Give the store a brand-new database: the next store call opens a new
 * engine on it. `initialized: false` makes it behave like a new PostgreSQL
 * database, so the first access seeds it (SEED_DEMO_DATA / bootstrap admin).
 */
export function useNewTestDatabase(options: { initialized?: boolean } = {}): MemoryDatabase {
  const current = state();
  current.database = new MemoryDatabase({ initialized: options.initialized ?? true });
  current.generation++;
  current.driver = null;
  return current.database;
}

/** Make the store open a new engine on the same database: what a server restart would load. */
export function reopenTestDatabase(): void {
  const current = state();
  current.generation++;
  current.driver = null;
}

/** The database the store currently uses, and its driver once the store has opened it. */
export function currentTestDatabase(): { database: MemoryDatabase; driver: MemoryDriver | null } {
  const current = state();
  return { database: current.database, driver: current.driver };
}
