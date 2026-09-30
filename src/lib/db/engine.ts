import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "@/lib/types";
import { ChangeTracker, changeSetSize, idOf, isEmptyChangeSet, type DiffMode, type DiffRequest, type PendingChanges } from "./changes";
import { isBusyError, type RawData } from "./sqlite-core.mjs";
import type { OpenOrigin, StoreDriver } from "./driver";

/**
 * The in-memory database plus its persistence, independent of the storage
 * backend (see `driver.ts`).
 *
 * Reads are served from memory. `mutate()` runs callbacks one at a time
 * (read-check-write inside one callback is atomic with respect to other
 * mutations) and schedules a coalesced write 150 ms later.
 *
 * With the SQLite driver only what changed is written, in one transaction
 * per flush, and the cost of finding it is proportional to what the
 * mutation touched rather than to the size of the database:
 *
 *  1. Inside a `mutate()` callback (and anything it awaits, via
 *     AsyncLocalStorage) `db.<collection>` is a thin Proxy over the real
 *     array. Documents themselves are never wrapped, so identity checks,
 *     spreads and serialization behave exactly as before.
 *       - `find`, `filter`, `at` and index reads record the documents they
 *         return as candidates; `push`/`unshift`/index writes record the new
 *         documents. Only candidates are serialized and compared at flush.
 *       - `splice`, `pop`, `shift`, shrinking `length`, replacing a document
 *         with one of another id, or assigning a whole new array switch the
 *         collection to an identity diff (ids compared, removed ids deleted).
 *       - Callbacks that may edit every element (`forEach`, `map`, `reduce`,
 *         iteration, `slice`, …) switch it to a full comparison.
 *  2. A background sweep compares, a slice at a time, every collection that
 *     was read since the previous sweep, so documents edited outside
 *     `mutate()` (an object kept from an earlier `findById`, say) are still
 *     stored — and logged, because such edits should go through `mutate()`.
 *     Its interval grows with its cost so it never takes more than about 5%
 *     of the CPU.
 *  3. On process exit and before backups everything outstanding is written
 *     synchronously.
 *
 * Another process writing to the same SQLite file (the `db:restore` script,
 * for instance) is noticed through `PRAGMA data_version`; the cache is then
 * reloaded after this process's own pending edits are stored.
 */

export interface EngineOptions {
  driver: StoreDriver;
  collections: readonly string[];
  /** Turn stored data into a complete Database (missing collections, settings defaults). Must keep document objects as they are. */
  normalize: (data: RawData) => Database;
  /** Contents of a brand-new database. */
  initialData: () => Promise<RawData>;
  flushDelayMs?: number;
  sweepDelayMs?: number;
  sweepSliceMs?: number;
  externalCheckMs?: number;
  onOpen?: (origin: OpenOrigin) => void;
}

/** Operations available inside `exclusive()` (no other mutation runs meanwhile). */
export interface ExclusiveContext {
  driver: StoreDriver;
  /** The current contents (live objects: do not modify). */
  data(): RawData;
  /** Replace everything and reload the cache. */
  replaceAll(data: RawData, source: string): Promise<void>;
}

export interface EngineStats {
  driver: StoreDriver["kind"];
  openedAt: string | null;
  origin: OpenOrigin | null;
  flushes: number;
  documentsWritten: number;
  /** Documents serialized to find changes (flushes and sweeps). */
  documentsCompared: number;
  lastFlushAt: string | null;
  lastFlushMs: number | null;
  lastSweepAt: string | null;
  lastSweepMs: number | null;
  /** Documents saved by the sweep that were changed outside mutate(). */
  untrackedWrites: number;
  externalReloads: number;
  pending: boolean;
  lastError: { message: string; at: string } | null;
}

const DEFAULTS = { flushDelayMs: 150, sweepDelayMs: 5000, sweepSliceMs: 8, externalCheckMs: 1000 };
const MAX_RETRY_MS = 30_000;
const UNTRACKED_WARNING_INTERVAL_MS = 10 * 60 * 1000;
/** The sweep waits at least this multiple of its own duration before running again (≈5% CPU). */
const SWEEP_COST_FACTOR = 20;
const SWEEP_CHUNK = 256;
const INDEX_KEY = /^(?:0|[1-9]\d{0,9})$/;

type Loose = Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;

interface PendingCollection {
  mode: DiffMode;
  candidates: Set<object>;
}

/** Marks the code running inside a mutate() callback; cleared when the callback returns. */
interface MutationScope {
  active: boolean;
}

/** Progress of a sweep through one collection. */
interface SweepCursor {
  names: string[];
  collection: number;
  index: number;
}

export class StoreEngine {
  readonly driver: StoreDriver;
  private readonly options: EngineOptions & typeof DEFAULTS;
  private collections: string[];
  private known: Set<string>;
  private db: Database | null = null;
  private view: Database | null = null;
  private loading: Promise<Database> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly tracker: ChangeTracker | null;
  private readonly scope = new AsyncLocalStorage<MutationScope>();
  private pending = new Map<string, PendingCollection>();
  /** Collections read or written since the last completed sweep. */
  private accessed = new Set<string>();
  private readonly proxies = new WeakMap<object, { name: string; proxy: unknown[] }>();
  private readonly unwrapped = new WeakMap<object, unknown[]>();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private failures = 0;
  private sweepTimer: NodeJS.Timeout | null = null;
  private sweeping = false;
  private nextSweepDelay: number;
  private lastExternalCheck = 0;
  private closed = false;
  private exitHandler: (() => void) | null = null;
  private readonly untrackedWarnedAt = new Map<string, number>();
  private readonly stats: EngineStats;

  constructor(options: EngineOptions) {
    this.options = { ...DEFAULTS, ...options };
    this.driver = options.driver;
    this.collections = [...options.collections];
    this.known = new Set(this.collections);
    this.tracker = options.driver.incremental ? new ChangeTracker() : null;
    this.nextSweepDelay = this.options.sweepDelayMs;
    this.stats = {
      driver: options.driver.kind,
      openedAt: null,
      origin: null,
      flushes: 0,
      documentsWritten: 0,
      documentsCompared: 0,
      lastFlushAt: null,
      lastFlushMs: null,
      lastSweepAt: null,
      lastSweepMs: null,
      untrackedWrites: 0,
      externalReloads: 0,
      pending: false,
      lastError: null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Public API (mirrored by store.ts)                                   */
  /* ------------------------------------------------------------------ */

  /** The database, loading it on first use. */
  async getDb(): Promise<Database> {
    if (this.db) {
      this.afterRead();
      return this.view!;
    }
    if (!this.loading) this.loading = this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  /** Run `fn` after every earlier mutation finished; persist what it changed. */
  mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      await this.getDb();
      this.checkExternal(true);
      const marker: MutationScope = { active: true };
      try {
        return await this.scope.run(marker, () => fn(this.view!));
      } finally {
        marker.active = false;
        this.schedulePersist();
      }
    });
  }

  /** Write pending changes now. */
  async flush(): Promise<void> {
    if (!this.db || !this.dirty) return;
    await this.enqueue(() => this.persistPending());
  }

  /**
   * Run `fn` with the whole store to itself: every earlier mutation has
   * finished and everything in memory has been written first.
   */
  async exclusive<T>(fn: (ctx: ExclusiveContext) => T | Promise<T>): Promise<T> {
    await this.getDb();
    return this.enqueue(async () => {
      await this.persistEverything();
      return fn({
        driver: this.driver,
        data: () => this.raw(this.db!),
        replaceAll: (data, source) => this.replaceAllNow(data, source),
      });
    });
  }

  /** Replace everything (demo reset, restore). */
  async replaceAll(data: RawData, source: string): Promise<void> {
    await this.getDb();
    await this.enqueue(() => this.replaceAllNow(data, source));
  }

  /** Register collections added after the engine was created (development hot reload). */
  adoptCollections(names: readonly string[]): void {
    const added = names.filter((name) => !this.known.has(name));
    if (!added.length) return;
    for (const name of added) {
      this.known.add(name);
      this.collections.push(name);
    }
    this.driver.addCollections?.(added);
    if (this.db) {
      const target = this.db as unknown as Loose;
      for (const name of added) if (!Array.isArray(target[name])) target[name] = [];
    }
  }

  /** The loaded contents (live objects: do not modify), or null before the first load. */
  snapshot(): RawData | null {
    return this.db ? this.raw(this.db) : null;
  }

  /** Names of the collections this engine stores. */
  collectionNames(): readonly string[] {
    return this.collections;
  }

  getStats(): EngineStats {
    return { ...this.stats, pending: this.dirty || this.pending.size > 0 };
  }

  /** Write everything outstanding and release the storage. */
  close(): void {
    if (this.closed) return;
    this.writeOutstandingSync("close");
    this.closed = true;
    for (const timer of [this.flushTimer, this.retryTimer, this.sweepTimer]) if (timer) clearTimeout(timer);
    this.flushTimer = this.retryTimer = this.sweepTimer = null;
    if (this.exitHandler) process.off("exit", this.exitHandler);
    this.exitHandler = null;
    this.driver.close();
  }

  /* ------------------------------------------------------------------ */
  /* Loading                                                             */
  /* ------------------------------------------------------------------ */

  private async load(): Promise<Database> {
    const { data, origin } = await this.driver.open(this.options.initialData);
    const db = this.options.normalize(data);
    this.install(db, this.raw(db));
    this.stats.openedAt = new Date().toISOString();
    this.stats.origin = origin;
    if (this.driver.incremental && !this.exitHandler) {
      this.exitHandler = () => this.writeOutstandingSync("exit");
      process.on("exit", this.exitHandler);
    }
    this.options.onOpen?.(origin);
    return this.view!;
  }

  /** Adopt `db` as the cache; `stored` (built from the same objects) is what the storage holds. */
  private install(db: Database, stored: RawData): void {
    this.db = db;
    this.view = this.tracker ? this.createView(db) : db;
    this.tracker?.reset(stored.collections, stored.settings);
    this.pending.clear();
    this.accessed.clear();
    this.dirty = false;
  }

  private raw(db: Database): RawData {
    const source = db as unknown as Loose;
    const collections: Record<string, unknown[]> = {};
    for (const name of this.collections) {
      const value = source[name];
      collections[name] = Array.isArray(value) ? value : [];
    }
    return { collections, settings: db.settings };
  }

  /* ------------------------------------------------------------------ */
  /* Change tracking (SQLite driver)                                     */
  /* ------------------------------------------------------------------ */

  private inMutation(): boolean {
    return this.scope.getStore()?.active === true;
  }

  /** A change made through a tracked path; outside mutate() it needs its own flush. */
  private changed(): void {
    if (!this.inMutation()) this.schedulePersist();
  }

  private pendingFor(name: string): PendingCollection {
    let entry = this.pending.get(name);
    if (!entry) this.pending.set(name, (entry = { mode: "candidates", candidates: new Set() }));
    return entry;
  }

  private note(name: string, doc: unknown): void {
    if (doc && typeof doc === "object") this.pendingFor(name).candidates.add(doc);
  }

  private escalate(name: string, mode: "identity" | "full"): void {
    const entry = this.pendingFor(name);
    if (mode === "full" || entry.mode === "candidates") entry.mode = mode;
  }

  private createView(db: Database): Database {
    return new Proxy(db, {
      get: (target, key) => {
        const value = Reflect.get(target, key);
        if (typeof key !== "string" || !this.known.has(key)) return value;
        this.accessed.add(key);
        return Array.isArray(value) && this.inMutation() ? this.collectionProxy(key, value) : value;
      },
      set: (target, key, value) => {
        if (typeof key === "string" && this.known.has(key)) {
          this.accessed.add(key);
          this.escalate(key, "identity");
          Reflect.set(target, key, (value && this.unwrapped.get(value as object)) ?? value);
          this.changed();
          return true;
        }
        const ok = Reflect.set(target, key, value);
        if (key === "settings") this.changed();
        return ok;
      },
      deleteProperty: (target, key) => {
        if (typeof key === "string" && this.known.has(key)) this.escalate(key, "identity");
        const ok = Reflect.deleteProperty(target, key);
        this.changed();
        return ok;
      },
    });
  }

  /** The tracking Proxy for a collection array (one per array, so `db.x === db.x`). */
  private collectionProxy(name: string, raw: unknown[]): unknown[] {
    const cached = this.proxies.get(raw);
    if (cached && cached.name === name) return cached.proxy;
    const note = (doc: unknown) => this.note(name, doc);
    const noteAll = (docs: readonly unknown[]) => {
      for (const doc of docs) note(doc);
    };
    const identity = () => this.escalate(name, "identity");
    const full = () => this.escalate(name, "full");
    const changed = () => this.changed();
    const call = (method: string, args: unknown[]) => (raw as unknown as Record<string, AnyFn>)[method]!.apply(raw, args);

    // Run on the real array at native speed; record only what the call exposes or changes.
    const methods: Record<string | symbol, AnyFn> = {
      find: (...args) => {
        const found = call("find", args);
        note(found);
        return found;
      },
      findLast: (...args) => {
        const found = call("findLast", args);
        note(found);
        return found;
      },
      at: (...args) => {
        const found = call("at", args);
        note(found);
        return found;
      },
      filter: (...args) => {
        const found = call("filter", args) as unknown[];
        noteAll(found);
        return found;
      },
      push: (...items) => {
        noteAll(items);
        const length = raw.push(...items);
        changed();
        return length;
      },
      unshift: (...items) => {
        noteAll(items);
        const length = raw.unshift(...items);
        changed();
        return length;
      },
      splice: (...args) => {
        identity();
        noteAll(args.slice(2));
        const removed = call("splice", args);
        changed();
        return removed;
      },
      pop: () => {
        identity();
        const removed = raw.pop();
        changed();
        return removed;
      },
      shift: () => {
        identity();
        const removed = raw.shift();
        changed();
        return removed;
      },
      // Reordering is not persisted (documents are stored in insertion order), so it records nothing.
      sort: (...args) => {
        call("sort", args);
        return proxy;
      },
      reverse: () => {
        raw.reverse();
        return proxy;
      },
      fill: (...args) => {
        identity();
        note(args[0]);
        call("fill", args);
        changed();
        return proxy;
      },
      copyWithin: (...args) => {
        identity();
        call("copyWithin", args);
        changed();
        return proxy;
      },
    };
    // Callbacks and copies that expose every element: any of them may be edited.
    for (const method of ["forEach", "map", "flatMap", "reduce", "reduceRight", "slice", "concat", "values", "entries", "toSorted", "toReversed", "toSpliced", "with", "flat"]) {
      methods[method] = (...args) => {
        full();
        return call(method, args);
      };
    }
    methods[Symbol.iterator] = () => {
      full();
      return raw[Symbol.iterator]();
    };

    // Declared after `methods`, which only read it when called (sort/reverse/fill/copyWithin return it).
    const proxy: unknown[] = new Proxy(raw, {
      get: (target, key) => {
        if (typeof key === "string" && INDEX_KEY.test(key)) {
          const value = (target as unknown as Loose)[key];
          note(value);
          return value;
        }
        if (Object.hasOwn(methods, key)) return methods[key];
        return Reflect.get(target, key);
      },
      set: (target, key, value) => {
        if (typeof key === "string") {
          if (key === "length") {
            if (typeof value === "number" && value < target.length) identity();
          } else if (INDEX_KEY.test(key)) {
            const previous = (target as unknown as Loose)[key];
            note(value);
            if (previous !== undefined && idOf(previous) !== idOf(value)) identity();
          }
        }
        const ok = Reflect.set(target, key, value);
        changed();
        return ok;
      },
      deleteProperty: (target, key) => {
        identity();
        const ok = Reflect.deleteProperty(target, key);
        changed();
        return ok;
      },
      defineProperty: (target, key, descriptor) => {
        identity();
        if ("value" in descriptor) note(descriptor.value);
        const ok = Reflect.defineProperty(target, key, descriptor);
        changed();
        return ok;
      },
    });
    this.proxies.set(raw, { name, proxy });
    this.unwrapped.set(proxy, raw);
    return proxy;
  }

  /** Take the recorded changes as diff requests. */
  private takePending(): DiffRequest[] {
    const requests: DiffRequest[] = [];
    for (const [name, entry] of this.pending) {
      if (this.known.has(name)) requests.push({ name, mode: entry.mode, candidates: entry.candidates });
    }
    this.pending.clear();
    return requests;
  }

  /** Put requests back after a failed write so the next attempt finds them again. */
  private restorePending(requests: readonly DiffRequest[]): void {
    for (const request of requests) {
      if (request.mode !== "candidates") this.escalate(request.name, request.mode);
      for (const doc of request.candidates ?? []) this.note(request.name, doc);
    }
  }

  /** Everything that may differ from storage: recorded changes plus a full comparison of every collection read since the last sweep. */
  private outstandingRequests(): DiffRequest[] {
    const requests = this.takePending();
    for (const name of this.accessed) if (this.known.has(name)) requests.push({ name, mode: "full" });
    return requests;
  }

  /* ------------------------------------------------------------------ */
  /* Scheduling                                                          */
  /* ------------------------------------------------------------------ */

  private enqueue<T>(task: () => T | Promise<T>): Promise<T> {
    this.queued++;
    const run = async () => {
      try {
        return await task();
      } finally {
        this.queued--;
      }
    };
    const current = this.chain.then(run, run);
    this.chain = current.then(
      () => undefined,
      () => undefined,
    );
    return current;
  }

  private schedulePersist(): void {
    this.dirty = true;
    if (this.flushTimer || this.retryTimer || this.closed) return;
    // Coalesce bursts of writes (progress heartbeats, bulk inserts) into one flush.
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.options.flushDelayMs);
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed) return;
    this.failures++;
    const delay = Math.min(MAX_RETRY_MS, 250 * 2 ** this.failures);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  /** Cheap bookkeeping on every read: external-change check and sweep scheduling. */
  private afterRead(): void {
    if (!this.tracker) return;
    if (this.queued === 0) this.checkExternal(false);
    this.scheduleSweep();
  }

  private scheduleSweep(): void {
    if (!this.tracker || this.sweepTimer || this.sweeping || this.closed || this.accessed.size === 0) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      void this.sweep();
    }, this.nextSweepDelay);
    this.sweepTimer.unref?.();
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  private async persistPending(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.db || !this.dirty) return;
    this.dirty = false;
    if (this.tracker) {
      const started = performance.now();
      const requests = this.takePending();
      if (this.write(this.diff(requests), "flush")) {
        this.stats.lastFlushMs = Math.round(performance.now() - started);
        this.scheduleSweep();
      } else {
        this.restorePending(requests);
        this.dirty = true;
        this.scheduleRetry();
      }
      return;
    }
    try {
      await this.driver.persist(this.raw(this.db), null);
      this.recordFlush(0);
    } catch (err) {
      this.dirty = true;
      this.recordError("save the database", err);
      this.scheduleRetry();
    }
  }

  /** Write every difference between memory and storage (before backups and exclusive operations). */
  private async persistEverything(): Promise<void> {
    if (!this.db) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.tracker) {
      const requests = this.outstandingRequests();
      this.dirty = false;
      if (!this.write(this.diff(requests), "flush")) {
        this.restorePending(requests);
        this.dirty = true;
        throw new Error(this.stats.lastError?.message ?? "Pending changes could not be written to the database.");
      }
      this.accessed.clear();
      return;
    }
    if (!this.dirty) return;
    this.dirty = false;
    try {
      await this.driver.persist(this.raw(this.db), null);
      this.recordFlush(0);
    } catch (err) {
      this.dirty = true;
      throw err;
    }
  }

  private async replaceAllNow(data: RawData, source: string): Promise<void> {
    const db = this.options.normalize(data);
    const stored = this.raw(db);
    await this.driver.replaceAll(stored, source);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.install(db, stored);
  }

  /** Synchronous last-chance write (process exit, close). */
  private writeOutstandingSync(reason: "exit" | "close"): void {
    if (!this.db || this.closed || !this.tracker) return;
    try {
      this.write(this.diff(this.outstandingRequests()), reason);
    } catch (err) {
      console.error(`[store] could not write outstanding changes on ${reason}:`, err);
    }
  }

  private diff(requests: DiffRequest[]): PendingChanges {
    const db = this.db!;
    const pending = this.tracker!.diff(db as unknown as Loose, requests, db.settings);
    this.stats.documentsCompared += pending.compared;
    for (const [name, n] of pending.invalid) console.warn(`[store] ${n} document(s) in "${name}" have no id and cannot be saved.`);
    for (const [name, n] of pending.duplicates) console.warn(`[store] "${name}" contains ${n} document(s) with a duplicate id; only the first copy is saved.`);
    return pending;
  }

  /** Store a diff; false (logged) when the storage refused it. */
  private write(pending: PendingChanges, reason: "flush" | "sweep" | "exit" | "close" | "reload"): boolean {
    if (isEmptyChangeSet(pending.changeSet)) {
      this.tracker!.commit(pending);
      this.failures = 0;
      return true;
    }
    try {
      this.driver.persist(this.raw(this.db!), pending.changeSet);
    } catch (err) {
      this.recordError(isBusyError(err) ? "save changes (the database is locked by another process)" : `save changes (${reason})`, err);
      return false;
    }
    this.tracker!.commit(pending);
    this.recordFlush(changeSetSize(pending.changeSet));
    return true;
  }

  private recordFlush(documents: number): void {
    this.failures = 0;
    this.stats.flushes++;
    this.stats.documentsWritten += documents;
    this.stats.lastFlushAt = new Date().toISOString();
  }

  private recordError(action: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.stats.lastError = { message: `Could not ${action}: ${message}`, at: new Date().toISOString() };
    console.error(`[store] could not ${action}:`, err);
  }

  /* ------------------------------------------------------------------ */
  /* Sweep (changes made outside mutate)                                 */
  /* ------------------------------------------------------------------ */

  private async sweep(): Promise<void> {
    if (!this.tracker || this.sweeping || this.closed || !this.db) return;
    this.sweeping = true;
    const cursor: SweepCursor = { names: [...this.accessed].filter((name) => this.known.has(name)), collection: 0, index: 0 };
    this.accessed.clear();
    let busy = 0;
    try {
      while (cursor.collection < cursor.names.length && !this.closed && this.db) {
        const started = performance.now();
        const ok = await this.enqueue(() => this.sweepSlice(cursor));
        busy += performance.now() - started;
        if (!ok) {
          // Compare the rest next time.
          for (const name of cursor.names.slice(cursor.collection)) this.accessed.add(name);
          break;
        }
        // Let requests run between slices.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      this.stats.lastSweepAt = new Date().toISOString();
      this.stats.lastSweepMs = Math.round(busy);
      this.nextSweepDelay = Math.max(this.options.sweepDelayMs, Math.round(busy * SWEEP_COST_FACTOR));
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Compare the next documents of the sweep until the time budget is used.
   * Recorded changes are flushed first, so whatever the slice finds was
   * changed outside mutate(). A collection's last slice also compares ids,
   * which stores documents added or removed behind the store's back.
   */
  private sweepSlice(cursor: SweepCursor): boolean {
    if (!this.db || !this.tracker) return true;
    if (this.pending.size || this.dirty) {
      const requests = this.takePending();
      this.dirty = false;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (!this.write(this.diff(requests), "flush")) {
        this.restorePending(requests);
        this.dirty = true;
        this.scheduleRetry();
        return false;
      }
    }
    const started = performance.now();
    const requests: DiffRequest[] = [];
    const source = this.db as unknown as Loose;
    while (cursor.collection < cursor.names.length) {
      const name = cursor.names[cursor.collection]!;
      const docs = Array.isArray(source[name]) ? (source[name] as unknown[]) : [];
      const end = Math.min(docs.length, cursor.index + SWEEP_CHUNK);
      if (cursor.index < end) requests.push({ name, mode: "candidates", candidates: docs.slice(cursor.index, end) });
      cursor.index = end;
      if (cursor.index >= docs.length) {
        requests.push({ name, mode: "identity" });
        cursor.collection++;
        cursor.index = 0;
      }
      if (performance.now() - started >= this.options.sweepSliceMs) break;
    }
    const pending = this.diff(requests);
    if (!this.write(pending, "sweep")) {
      this.scheduleRetry();
      return false;
    }
    for (const change of pending.changeSet.collections) this.reportUntracked(change.name, change.upserts.length + change.deletes.length);
    return true;
  }

  private reportUntracked(name: string, documents: number): void {
    this.stats.untrackedWrites += documents;
    const now = Date.now();
    const last = this.untrackedWarnedAt.get(name) ?? 0;
    if (now - last < UNTRACKED_WARNING_INTERVAL_MS) return;
    this.untrackedWarnedAt.set(name, now);
    console.warn(
      `[store] saved ${documents} change(s) to "${name}" that were made outside mutate()/insert()/update(); they are only written by the background sweep. Make the change inside mutate() so it is saved right away.`,
    );
  }

  /* ------------------------------------------------------------------ */
  /* External changes                                                    */
  /* ------------------------------------------------------------------ */

  private checkExternal(force: boolean): void {
    if (!this.tracker || !this.db || this.closed) return;
    const now = Date.now();
    if (!force && now - this.lastExternalCheck < this.options.externalCheckMs) return;
    this.lastExternalCheck = now;
    let changed: boolean;
    try {
      changed = this.driver.hasExternalChanges();
    } catch (err) {
      this.recordError("check the database for outside changes", err);
      return;
    }
    if (!changed) return;
    // Keep this process's unsaved edits (they win per document), then read everything again.
    this.write(this.diff(this.outstandingRequests()), "reload");
    const data = this.driver.reload();
    const db = this.options.normalize(data);
    this.install(db, this.raw(db));
    this.stats.externalReloads++;
    console.info("[store] the database was changed by another process; reloaded it.");
  }
}
