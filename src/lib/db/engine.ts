import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "@/lib/types";
import { ChangeTracker, changeSetSize, idOf, isEmptyChangeSet, type DiffMode, type DiffRequest, type PendingChanges, type StoredIdWalk } from "./changes";
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
 *  1. `db.<collection>` is a thin Proxy over the real array (always the same
 *     one for an array, so identity checks and caches keyed on the array
 *     keep working). Array methods run on the real array at native speed;
 *     documents themselves are never wrapped, so spreads, comparisons and
 *     serialization behave exactly as before.
 *       - Writes are always recorded: `push` and index assignment record
 *         the new documents; `splice`, `pop`, `shift`, `unshift`, `sort`,
 *         `reverse`, shrinking `length`, replacing a document with one of
 *         another id, or assigning a whole new array switch the collection
 *         to an identity diff (ids and their order compared, removed ids
 *         deleted).
 *       - Reads are recorded only inside a `mutate()` callback (and anything
 *         it awaits, via AsyncLocalStorage): `find`, `filter`, `at`,
 *         `findIndex` and index reads record the documents they return as
 *         candidates, which are serialized and compared at flush. Calls that
 *         hand out every element (`forEach`, `map`, `reduce`, iteration,
 *         `slice`, …) switch the collection to a full comparison. Pure
 *         tests (`some`, `every`, `includes`, `indexOf`) record nothing.
 *  2. A background sweep compares, a slice at a time, every collection that
 *     was read since the previous sweep, so documents edited where the
 *     engine cannot see it (an object kept from an earlier `findById` and
 *     changed later, say) are still stored — and logged, because such edits
 *     should be made on a document obtained inside `mutate()`. Its interval
 *     grows with its cost so it never takes more than about 5% of the CPU.
 *  3. `flush()`, backups, process exit and `close()` compare everything, so
 *     afterwards the storage equals memory whatever the code did.
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
  /** Time the last sweep spent comparing (the sum of its slices). */
  lastSweepMs: number | null;
  /** Longest slice of the last sweep: how long it held the event loop at once. */
  lastSweepMaxSliceMs: number | null;
  /** Documents the last sweep compared. */
  lastSweepDocuments: number | null;
  /** How long the first load took (open, integrity check, reading every document, fingerprints). */
  loadMs: number | null;
  /** Documents held in memory after the first load. */
  loadedDocuments: number | null;
  /** Documents saved by the sweep that were changed where the engine could not see it. */
  untrackedWrites: number;
  externalReloads: number;
  pending: boolean;
  lastError: { message: string; at: string } | null;
}

const DEFAULTS = { flushDelayMs: 150, sweepDelayMs: 5000, sweepSliceMs: 8, externalCheckMs: 1000 };
const MAX_RETRY_MS = 30_000;
const WARNING_INTERVAL_MS = 10 * 60 * 1000;
/** The sweep waits at least this multiple of its own duration before running again (≈5% CPU). */
const SWEEP_COST_FACTOR = 20;
const SWEEP_CHUNK = 256;
/** A sweep walk restarted this often (removals keep happening meanwhile) settles the collection with one identity diff. */
const MAX_WALK_RESTARTS = 2;
const INDEX_KEY = /^(?:0|[1-9]\d{0,9})$/;

/** Array methods that return a member: the result is recorded as a candidate. */
const RETURNS_MEMBER = ["find", "findLast", "at"] as const;
/** Array methods that return the position of a member: that member is recorded as a candidate. */
const RETURNS_INDEX = ["findIndex", "findLastIndex"] as const;
/** Array methods that only answer a question: nothing is recorded. */
const READ_ONLY = ["some", "every", "includes", "indexOf", "lastIndexOf", "join", "keys"] as const;
/** Array methods that hand out every member (callbacks, copies, iterators): any of them may be edited. */
const EXPOSES_ALL = ["forEach", "map", "flatMap", "reduce", "reduceRight", "slice", "concat", "values", "entries", "toSorted", "toReversed", "toSpliced", "with", "flat"] as const;

type Loose = Record<string, unknown>;
type AnyFn = (...args: unknown[]) => unknown;
type WriteReason = "flush" | "sweep" | "exit" | "close" | "reload";

interface PendingCollection {
  mode: DiffMode;
  candidates: Set<object>;
}

/** Marks the code running inside a mutate() callback; cleared when the callback returns. */
interface MutationScope {
  active: boolean;
}

/** Progress of a sweep through the collections read since the previous one. */
interface SweepCursor {
  names: string[];
  collection: number;
  index: number;
  /** Documents compared so far. */
  compared: number;
  /** Stored ids of the current collection, matched against the array chunk by chunk. */
  walk: StoredIdWalk | null;
  /** Times the current collection's walk was restarted after a concurrent removal or reorder. */
  restarts: number;
}

/** What one sweep did (see `sweepNow()`). */
export interface SweepReport {
  /** Collections it compared. */
  collections: number;
  /** Documents it serialized and compared. */
  documents: number;
  /** Slices it ran; requests are served between slices. */
  slices: number;
  /** Time spent comparing (the sum of the slices). */
  busyMs: number;
  /** Longest slice: the longest the event loop was held at once. */
  maxSliceMs: number;
  /** From start to end, including the time other work ran between slices. */
  wallMs: number;
  /** False when a write failed or the engine closed before every collection was compared (the rest is compared next time). */
  complete: boolean;
}

export class StoreEngine {
  readonly driver: StoreDriver;
  private readonly options: EngineOptions & typeof DEFAULTS;
  private collections: string[];
  private known: Set<string>;
  /** The cache. One object for the engine's lifetime: reloads swap its contents, so a `db` kept by a caller stays current. */
  private db: Database | null = null;
  /** What callers get: `db` itself, or (incremental drivers) the tracking Proxy over it. */
  private view: Database | null = null;
  private loading: Promise<Database> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private readonly tracker: ChangeTracker | null;
  private readonly scope = new AsyncLocalStorage<MutationScope>();
  /** A mutate() callback is running (they run one at a time). */
  private mutating = false;
  private pending = new Map<string, PendingCollection>();
  /** Collections read or written since the last sweep started. */
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
  /** Another process changed the storage and the cache has not been reloaded yet. */
  private reloadNeeded = false;
  private closed = false;
  private exitHandler: (() => void) | null = null;
  private readonly warnedAt = new Map<string, number>();
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
      lastSweepMaxSliceMs: null,
      lastSweepDocuments: null,
      loadMs: null,
      loadedDocuments: null,
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
      this.mutating = true;
      try {
        return await this.scope.run(marker, () => fn(this.view!));
      } finally {
        marker.active = false;
        this.mutating = false;
        this.schedulePersist();
      }
    });
  }

  /**
   * Write every difference between memory and storage now. Unlike the
   * coalesced write after a mutation this compares all documents, so it also
   * stores edits the engine could not see. A failed write is logged and
   * retried; it does not reject.
   */
  async flush(): Promise<void> {
    if (!this.db || this.closed) return;
    if (!this.tracker && !this.dirty) return;
    await this.enqueue(() => this.persistEverything());
  }

  /**
   * Run `fn` with the whole store to itself: every earlier mutation has
   * finished and everything in memory has been written first.
   */
  async exclusive<T>(fn: (ctx: ExclusiveContext) => T | Promise<T>): Promise<T> {
    await this.getDb();
    return this.enqueue(async () => {
      if (!(await this.persistEverything())) {
        throw new Error(this.stats.lastError?.message ?? "Pending changes could not be written to the database.");
      }
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

  /**
   * Store the changes recorded so far now instead of when the coalesced
   * write timer fires. It does the same work as that write (only the
   * documents mutations touched are compared), so it costs what one flush
   * costs; use it where a change must be on disk before answering, and
   * `flush()` where edits made outside `mutate()` must be included too.
   * Returns false when the write failed (the changes are kept and retried).
   */
  async writePending(): Promise<boolean> {
    if (!this.db || this.closed) return true;
    return this.enqueue(() => this.persistPending());
  }

  /**
   * Run the background comparison now, over `names` (default: the
   * collections handed out since the previous sweep), in the same small
   * slices as the scheduled one. Resolves with what it did, or null when a
   * sweep is already running, the engine is closed or the driver writes
   * whole files anyway.
   */
  async sweepNow(names?: readonly string[]): Promise<SweepReport | null> {
    if (!this.tracker || this.closed) return null;
    await this.getDb();
    return this.sweep(names);
  }

  /** Write everything outstanding and release the storage. */
  close(reason: "exit" | "close" = "close"): void {
    if (this.closed) return;
    if (this.db && this.tracker) this.writeEverything(reason);
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
    const started = performance.now();
    const { data, origin } = await this.driver.open(this.options.initialData);
    const db = this.options.normalize(data);
    const stored = this.raw(db);
    this.install(db, stored);
    this.stats.openedAt = new Date().toISOString();
    this.stats.origin = origin;
    this.stats.loadMs = Math.round(performance.now() - started);
    this.stats.loadedDocuments = Object.values(stored.collections).reduce((n, docs) => n + docs.length, 0);
    if (this.driver.incremental && !this.exitHandler) {
      // Last chance on shutdown: write what is outstanding and leave a complete database file.
      this.exitHandler = () => this.close("exit");
      process.on("exit", this.exitHandler);
    }
    this.options.onOpen?.(origin);
    return this.view!;
  }

  /** Make `next` the cache contents; `stored` (built from the same objects) is what the storage holds. */
  private install(next: Database, stored: RawData): void {
    if (this.db) {
      // Swap the contents in place so the object handed out by getDb() stays valid.
      const target = this.db as unknown as Loose;
      const source = next as unknown as Loose;
      for (const key of Object.keys(target)) if (!Object.hasOwn(source, key)) delete target[key];
      Object.assign(target, source);
    } else {
      this.db = next;
      this.view = this.tracker ? this.createView(next) : next;
    }
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
  /* Change tracking (incremental drivers)                               */
  /* ------------------------------------------------------------------ */

  /** True for code running inside a mutate() callback (not for other requests reading meanwhile). */
  private inMutation(): boolean {
    return this.mutating && this.scope.getStore()?.active === true;
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

  /** Remember that a collection was handed out, for the next sweep. */
  private touch(name: string): void {
    if (this.accessed.has(name)) return;
    this.accessed.add(name);
    this.scheduleSweep();
  }

  private createView(db: Database): Database {
    return new Proxy(db, {
      get: (target, key) => {
        const value = Reflect.get(target, key);
        if (typeof key !== "string" || !this.known.has(key)) return value;
        this.touch(key);
        return Array.isArray(value) ? this.collectionProxy(key, value) : value;
      },
      set: (target, key, value) => {
        if (typeof key === "string" && this.known.has(key)) {
          this.touch(key);
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

    // Reads matter only inside a mutation; writes are recorded wherever they happen.
    const read = (doc: unknown) => {
      if (this.inMutation()) this.note(name, doc);
    };
    const added = (docs: readonly unknown[]) => {
      for (const doc of docs) this.note(name, doc);
    };
    /** Which documents are in the array, or their order, is about to change. */
    const membership = () => this.escalate(name, "identity");
    const changed = () => this.changed();
    const call = (method: string, args: unknown[]) => (raw as unknown as Record<string, AnyFn>)[method]!.apply(raw, args);

    // Every method runs on the real array at native speed; only what the call returns or changes is recorded.
    const methods = new Map<string | symbol, AnyFn>();
    for (const method of RETURNS_MEMBER) {
      methods.set(method, (...args) => {
        const found = call(method, args);
        read(found);
        return found;
      });
    }
    for (const method of RETURNS_INDEX) {
      methods.set(method, (...args) => {
        const index = call(method, args) as number;
        if (index !== -1) read(raw[index]);
        return index;
      });
    }
    for (const method of READ_ONLY) methods.set(method, (...args) => call(method, args));
    for (const method of EXPOSES_ALL) {
      methods.set(method, (...args) => {
        if (this.inMutation()) this.escalate(name, "full");
        return call(method, args);
      });
    }
    methods.set(Symbol.iterator, () => {
      if (this.inMutation()) this.escalate(name, "full");
      return raw[Symbol.iterator]();
    });
    methods.set("filter", (...args) => {
      const found = call("filter", args) as unknown[];
      if (this.inMutation()) added(found);
      return found;
    });
    methods.set("push", (...items) => {
      added(items);
      const length = raw.push(...items);
      changed();
      return length;
    });
    methods.set("unshift", (...items) => {
      membership();
      added(items);
      const length = raw.unshift(...items);
      changed();
      return length;
    });
    methods.set("splice", (...args) => {
      membership();
      added(args.slice(2));
      const removed = call("splice", args);
      changed();
      return removed;
    });
    methods.set("pop", () => {
      membership();
      const removed = raw.pop();
      changed();
      return removed;
    });
    methods.set("shift", () => {
      membership();
      const removed = raw.shift();
      changed();
      return removed;
    });
    methods.set("sort", (...args) => {
      membership();
      call("sort", args);
      changed();
      return proxy;
    });
    methods.set("reverse", () => {
      membership();
      raw.reverse();
      changed();
      return proxy;
    });
    methods.set("fill", (...args) => {
      membership();
      added([args[0]]);
      call("fill", args);
      changed();
      return proxy;
    });
    methods.set("copyWithin", (...args) => {
      membership();
      call("copyWithin", args);
      changed();
      return proxy;
    });

    // Declared after `methods`, which only read it when called (sort/reverse/fill/copyWithin return it).
    const proxy: unknown[] = new Proxy(raw, {
      get: (target, key) => {
        if (typeof key === "string") {
          const first = key.charCodeAt(0);
          if (first >= 48 && first <= 57) {
            // An index ("0", "42", …).
            const value = (target as unknown as Loose)[key];
            read(value);
            return value;
          }
        }
        return methods.get(key) ?? Reflect.get(target, key);
      },
      set: (target, key, value) => {
        if (typeof key === "string") {
          if (key === "length") {
            if (typeof value === "number" && value < target.length) membership();
          } else if (INDEX_KEY.test(key)) {
            const previous = (target as unknown as Loose)[key];
            if (previous !== value) {
              if (previous !== undefined) {
                // The replaced object left the array: it must not be compared in place of its successor.
                if (typeof previous === "object" && previous !== null) this.pending.get(name)?.candidates.delete(previous);
                if (idOf(previous) !== idOf(value)) membership();
              }
              this.note(name, value);
            }
          }
        }
        const ok = Reflect.set(target, key, value);
        changed();
        return ok;
      },
      deleteProperty: (target, key) => {
        membership();
        const ok = Reflect.deleteProperty(target, key);
        changed();
        return ok;
      },
      defineProperty: (target, key, descriptor) => {
        membership();
        if ("value" in descriptor) this.note(name, descriptor.value);
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
      this.persistSoon();
    }, this.options.flushDelayMs);
  }

  private scheduleRetry(): void {
    if (this.retryTimer || this.closed) return;
    this.failures++;
    const delay = Math.min(MAX_RETRY_MS, 250 * 2 ** this.failures);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.persistSoon();
    }, delay);
  }

  /** Queue the coalesced write behind the mutations that are running. */
  private persistSoon(): void {
    if (!this.db || !this.dirty || this.closed) return;
    this.enqueue(() => this.persistPending()).catch((err) => this.recordError("save the database", err));
  }

  private cancelFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
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
      this.sweep().catch((err) => this.recordError("check the database for unsaved changes", err));
    }, this.nextSweepDelay);
    this.sweepTimer.unref?.();
  }

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  /** The coalesced write after mutations: only what was recorded. */
  private async persistPending(): Promise<boolean> {
    this.cancelFlushTimer();
    if (!this.db || !this.dirty || this.closed) return true;
    if (!this.tracker) return this.persistWhole();
    const ok = this.writeTracked();
    if (ok) this.scheduleSweep();
    return ok;
  }

  /** Write every difference between memory and storage (flush(), backups, exclusive operations). */
  private async persistEverything(): Promise<boolean> {
    if (!this.db || this.closed) return true;
    if (!this.tracker) {
      this.cancelFlushTimer();
      return this.dirty ? this.persistWhole() : true;
    }
    return this.writeEverything("flush");
  }

  /** Non-incremental drivers: hand the whole database to the driver. */
  private async persistWhole(): Promise<boolean> {
    this.dirty = false;
    const started = performance.now();
    try {
      await this.driver.persist(this.raw(this.db!), null);
      this.recordFlush(0, started);
      return true;
    } catch (err) {
      this.dirty = true;
      this.recordError("save the database", err);
      this.scheduleRetry();
      return false;
    }
  }

  /** Write the recorded changes; after a failure they are kept and a retry is scheduled. */
  private writeTracked(): boolean {
    this.cancelFlushTimer();
    const requests = this.takePending();
    this.dirty = false;
    if (this.store(requests, "flush")) return true;
    this.restorePending(requests);
    this.dirty = true;
    this.scheduleRetry();
    return false;
  }

  /** Compare every collection with storage and write the differences; after a failure a retry is scheduled. */
  private writeEverything(reason: WriteReason): boolean {
    this.cancelFlushTimer();
    const requests = this.takePending();
    for (const name of this.collections) requests.push({ name, mode: "full" });
    this.dirty = false;
    if (this.store(requests, reason)) {
      this.accessed.clear();
      return true;
    }
    this.restorePending(requests);
    this.dirty = true;
    this.scheduleRetry();
    return false;
  }

  private async replaceAllNow(data: RawData, source: string): Promise<void> {
    const db = this.options.normalize(data);
    const stored = this.raw(db);
    await this.driver.replaceAll(stored, source);
    this.cancelFlushTimer();
    this.install(db, stored);
  }

  /**
   * Compare `requests` with what is stored and write the differences in one
   * transaction. Returns the diff, or null (logged) when it could not be
   * computed or stored; the tracker then still describes the storage.
   */
  private store(requests: DiffRequest[], reason: WriteReason): PendingChanges | null {
    const db = this.db!;
    const started = performance.now();
    let pending: PendingChanges;
    try {
      pending = this.tracker!.diff(db as unknown as Loose, requests, db.settings);
      // Incremental drivers write synchronously (see StoreDriver.incremental).
      if (!isEmptyChangeSet(pending.changeSet)) void this.driver.persist(this.raw(db), pending.changeSet);
    } catch (err) {
      this.recordError(isBusyError(err) ? "save changes (the database is locked by another process)" : `save changes (${reason})`, err);
      return null;
    }
    this.tracker!.commit(pending);
    this.failures = 0;
    this.stats.documentsCompared += pending.compared;
    if (!isEmptyChangeSet(pending.changeSet)) this.recordFlush(changeSetSize(pending.changeSet), started);
    for (const [name, n] of pending.invalid) this.warn(`invalid:${name}`, `${n} document(s) in "${name}" have no id and cannot be saved.`);
    for (const [name, n] of pending.duplicates) {
      this.warn(`duplicates:${name}`, `"${name}" contains ${n} document(s) with a duplicate id; only the first copy is saved.`);
    }
    return pending;
  }

  /** Count a write that reached the storage (`started`: when finding and writing it began). */
  private recordFlush(documents: number, started: number): void {
    this.failures = 0;
    this.stats.flushes++;
    this.stats.documentsWritten += documents;
    this.stats.lastFlushAt = new Date().toISOString();
    this.stats.lastFlushMs = Math.round(performance.now() - started);
  }

  private recordError(action: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.stats.lastError = { message: `Could not ${action}: ${message}`, at: new Date().toISOString() };
    console.error(`[store] could not ${action}:`, err);
  }

  /** Log a recurring condition at most once per interval and key. */
  private warn(key: string, message: string): void {
    const now = Date.now();
    if (now - (this.warnedAt.get(key) ?? -Infinity) < WARNING_INTERVAL_MS) return;
    this.warnedAt.set(key, now);
    console.warn(`[store] ${message}`);
  }

  /* ------------------------------------------------------------------ */
  /* Sweep (changes the engine could not see)                            */
  /* ------------------------------------------------------------------ */

  /**
   * Compare `names` (default: the collections handed out since the previous
   * sweep) with storage, one short slice at a time with other work running
   * in between, and store what differs.
   */
  private async sweep(names?: readonly string[]): Promise<SweepReport | null> {
    if (!this.tracker || this.sweeping || this.closed || !this.db) return null;
    this.sweeping = true;
    const wallStarted = performance.now();
    let selected: string[];
    if (names) {
      selected = [...new Set(names)].filter((name) => this.known.has(name));
      for (const name of selected) this.accessed.delete(name);
    } else {
      selected = [...this.accessed].filter((name) => this.known.has(name));
      this.accessed.clear();
    }
    const cursor: SweepCursor = { names: selected, collection: 0, index: 0, compared: 0, walk: null, restarts: 0 };
    const report: SweepReport = { collections: selected.length, documents: 0, slices: 0, busyMs: 0, maxSliceMs: 0, wallMs: 0, complete: true };
    try {
      while (cursor.collection < cursor.names.length) {
        if (this.closed) {
          report.complete = false;
          break;
        }
        const slice = await this.enqueue(() => this.sweepSlice(cursor));
        report.slices++;
        report.busyMs += slice.ms;
        report.maxSliceMs = Math.max(report.maxSliceMs, slice.ms);
        if (!slice.ok) {
          // Compare the rest next time.
          report.complete = false;
          for (const name of cursor.names.slice(cursor.collection)) this.accessed.add(name);
          break;
        }
        // Let requests run between slices.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      report.documents = cursor.compared;
      report.wallMs = performance.now() - wallStarted;
      this.stats.lastSweepAt = new Date().toISOString();
      this.stats.lastSweepMs = Math.round(report.busyMs);
      this.stats.lastSweepMaxSliceMs = Math.round(report.maxSliceMs * 10) / 10;
      this.stats.lastSweepDocuments = report.documents;
      this.nextSweepDelay = Math.max(this.options.sweepDelayMs, Math.round(report.busyMs * SWEEP_COST_FACTOR));
      return report;
    } finally {
      this.sweeping = false;
      this.scheduleSweep();
    }
  }

  /**
   * Compare the next documents of the sweep, a chunk at a time, until the
   * time budget is used. Recorded changes are flushed first, so whatever a
   * chunk finds was changed where the engine could not see it.
   *
   * Each chunk is compared document by document (which also stores
   * documents added behind the store's back), and its ids are matched
   * against the stored ids in stored order. When every id lines up and no
   * stored id is left over at the end, membership and order are unchanged,
   * so a large collection never needs one long pass over all its ids. Only
   * when they do not line up (a document removed, reordered or duplicated
   * where the engine could not see it) is the collection settled with one
   * `identity` diff.
   */
  private sweepSlice(cursor: SweepCursor): { ok: boolean; ms: number } {
    const started = performance.now();
    const result = (ok: boolean) => ({ ok, ms: performance.now() - started });
    if (!this.db || !this.tracker || this.closed) return result(true);
    if ((this.pending.size || this.dirty) && !this.writeTracked()) return result(false);
    const source = this.db as unknown as Loose;
    const nextCollection = () => {
      cursor.collection++;
      cursor.index = 0;
      cursor.walk = null;
      cursor.restarts = 0;
    };
    while (cursor.collection < cursor.names.length) {
      const name = cursor.names[cursor.collection]!;
      const docs = Array.isArray(source[name]) ? (source[name] as unknown[]) : [];
      cursor.walk ??= this.tracker.walkIds(name);
      if (!cursor.walk.valid()) {
        // Ids were removed or renumbered by a tracked write between slices: walk again from the start.
        if (++cursor.restarts > MAX_WALK_RESTARTS) {
          if (!this.sweepStore(name, "identity", [], cursor)) return result(false);
          nextCollection();
          continue;
        }
        cursor.index = 0;
        cursor.walk = this.tracker.walkIds(name);
      }
      const end = Math.min(docs.length, cursor.index + SWEEP_CHUNK);
      const chunk = docs.slice(cursor.index, end);
      if (!this.sweepStore(name, "candidates", chunk, cursor)) return result(false);
      // Membership and order: the chunk's ids must be the next stored ids.
      const walk = cursor.walk;
      let aligned = walk.valid();
      for (let i = 0; aligned && i < chunk.length; i++) {
        const id = idOf(chunk[i]);
        if (id !== null && walk.next() !== id) aligned = false;
      }
      const last = end >= docs.length;
      if (aligned && last && walk.next() !== null) aligned = false;
      if (!aligned && walk.valid()) {
        // A real difference (or a duplicate id): settle the whole collection at once.
        if (!this.sweepStore(name, "identity", [], cursor)) return result(false);
        nextCollection();
      } else if (!aligned) {
        // Invalidated during this chunk; the next round restarts the walk.
        cursor.index = end;
      } else if (last) {
        nextCollection();
      } else {
        cursor.index = end;
      }
      if (performance.now() - started >= this.options.sweepSliceMs) break;
    }
    return result(true);
  }

  /** One sweep comparison: store what differs and report it as changes the engine could not see. */
  private sweepStore(name: string, mode: DiffMode, candidates: unknown[], cursor: SweepCursor): boolean {
    const found = this.store([{ name, mode, candidates }], "sweep");
    if (!found) {
      this.scheduleRetry();
      return false;
    }
    cursor.compared += found.compared;
    for (const change of found.changeSet.collections) {
      this.reportUntracked(`"${change.name}"`, change.upserts.length + change.deletes.length + (change.order ? 1 : 0));
    }
    if (found.changeSet.settings !== null) this.reportUntracked("the settings", 1);
    return true;
  }

  private reportUntracked(what: string, documents: number): void {
    this.stats.untrackedWrites += documents;
    this.warn(
      `untracked:${what}`,
      `saved ${documents} change(s) to ${what} that the store could not see being made (a document fetched earlier and edited later, or edited outside mutate()); they are only picked up by the background check. Fetch the document inside the mutate() callback that changes it so it is saved right away.`,
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
    if (!this.reloadNeeded) {
      try {
        this.reloadNeeded = this.driver.hasExternalChanges();
      } catch (err) {
        this.recordError("check the database for outside changes", err);
        return;
      }
      if (!this.reloadNeeded) return;
    }
    // Keep this process's unsaved edits (they win per document), then read everything again.
    // If they cannot be written now, the cache is kept and the reload is tried again at the next check.
    if (!this.writeEverything("reload")) return;
    let data: RawData;
    try {
      data = this.driver.reload();
    } catch (err) {
      this.recordError("reload the database after an outside change", err);
      return;
    }
    const db = this.options.normalize(data);
    this.install(db, this.raw(db));
    this.reloadNeeded = false;
    this.stats.externalReloads++;
    console.info("[store] the database was changed by another process; reloaded it.");
  }
}
