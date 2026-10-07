import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import type { ChangeSet, OpenResult, RawData, StorageInfo, StoreDriver } from "@/lib/db/driver";

/**
 * Postgres phase 1: the store engine with an asynchronous driver (the shape
 * of the PostgreSQL driver), without a database. Writes must be awaited,
 * never overlap, survive failures, include edits made outside mutate(),
 * reach storage on close(), and a change by another process must be
 * reloaded before the next mutation runs.
 */

const COLLECTIONS = ["users", "courses"] as const;
type Row = { id: string; name?: string; title?: string };

const original = { info: console.info, warn: console.warn, error: console.error };
before(() => {
  console.info = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
});
after(() => Object.assign(console, original));

const engines: StoreEngine[] = [];
afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
});

function normalize(data: RawData): Database {
  const db = {} as Record<string, unknown>;
  for (const name of COLLECTIONS) db[name] = Array.isArray(data.collections[name]) ? data.collections[name] : [];
  db.settings = data.settings ?? { siteName: "Test" };
  return db as unknown as Database;
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** In-memory "remote" storage with the PostgreSQL driver's asynchronous behaviour. */
class FakeAsyncDriver implements StoreDriver {
  readonly kind = "postgres" as const;
  readonly incremental = true;
  readonly asynchronous = true;
  readonly backupsDir = "unused";
  tables = new Map<string, Map<string, string>>();
  settings: string | null = null;
  seq = 0;
  private seen = 0;
  inFlight = 0;
  maxInFlight = 0;
  persists = 0;
  failNext = 0;
  closed = false;
  latencyMs = 5;

  constructor(initial: RawData) {
    this.load(initial);
  }

  private load(data: RawData) {
    this.tables = new Map();
    for (const name of COLLECTIONS) {
      const map = new Map<string, string>();
      for (const doc of data.collections[name] ?? []) map.set((doc as Row).id, JSON.stringify(doc));
      this.tables.set(name, map);
    }
    this.settings = data.settings ? JSON.stringify(data.settings) : null;
  }

  read(): RawData {
    const collections: Record<string, unknown[]> = {};
    for (const [name, map] of this.tables) collections[name] = [...map.values()].map((json) => JSON.parse(json));
    return { collections, settings: this.settings ? JSON.parse(this.settings) : null };
  }

  ids(name: string): string[] {
    return [...(this.tables.get(name)?.keys() ?? [])];
  }

  doc(name: string, id: string): Row | null {
    const json = this.tables.get(name)?.get(id);
    return json ? (JSON.parse(json) as Row) : null;
  }

  /** Another process writes. */
  externalWrite(name: string, doc: Row) {
    this.tables.get(name)!.set(doc.id, JSON.stringify(doc));
    this.seq++;
  }

  async open(): Promise<OpenResult> {
    await delay(this.latencyMs);
    this.seen = this.seq;
    return { data: this.read(), origin: "existing" };
  }

  async persist(_data: RawData, changes: ChangeSet | null): Promise<void> {
    if (!changes) return;
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      await delay(this.latencyMs);
      if (this.failNext > 0) {
        this.failNext--;
        throw new Error("connection lost");
      }
      for (const change of changes.collections) {
        const map = this.tables.get(change.name)!;
        for (const { id, json } of change.upserts) map.set(id, json);
        for (const id of change.deletes) map.delete(id);
        if (change.order) {
          const next = new Map<string, string>();
          for (const id of change.order) next.set(id, map.get(id)!);
          this.tables.set(change.name, next);
        }
      }
      if (changes.settings !== null) this.settings = changes.settings;
      this.seq++;
      this.seen = this.seq;
      this.persists++;
    } finally {
      this.inFlight--;
    }
  }

  async replaceAll(data: RawData): Promise<void> {
    await delay(this.latencyMs);
    this.load(data);
    this.seen = ++this.seq;
  }

  async hasExternalChanges(): Promise<boolean> {
    await delay(1);
    return this.seq !== this.seen;
  }

  async reload(): Promise<RawData> {
    await delay(this.latencyMs);
    this.seen = this.seq;
    return this.read();
  }

  async backupTo(): Promise<void> {}

  async checkIntegrity(): Promise<{ ok: boolean; messages: string[] }> {
    return { ok: true, messages: ["ok"] };
  }

  info(): StorageInfo {
    return { driver: "postgres", file: "fake", sizeBytes: null, walBytes: null, modifiedAt: null, sqliteVersion: null, schemaVersion: null, meta: {} };
  }

  async close(): Promise<void> {
    await delay(1);
    this.closed = true;
  }
}

function sample(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Grace" },
      ],
      courses: [{ id: "c1", title: "Intro" }],
    },
    settings: { siteName: "Test" },
  };
}

function setup(options: { externalCheckMs?: number } = {}) {
  const driver = new FakeAsyncDriver(sample());
  const engine = new StoreEngine({
    driver,
    collections: COLLECTIONS,
    normalize,
    initialData: async () => sample(),
    flushDelayMs: 2,
    sweepDelayMs: 20,
    externalCheckMs: options.externalCheckMs ?? 1_000_000,
  });
  engines.push(engine);
  return { driver, engine };
}

const users = (db: Database) => db.users as unknown as Row[];

describe("store engine with an asynchronous driver", () => {
  it("writes inserts, updates, removals and reorders, one transaction at a time", async () => {
    const { driver, engine } = setup();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        engine.mutate((db) => {
          users(db).push({ id: `n${i}`, name: `New ${i}` });
        }),
      ),
    );
    await engine.mutate((db) => {
      users(db).find((u) => u.id === "u1")!.name = "Ada L.";
      const index = users(db).findIndex((u) => u.id === "u2");
      users(db).splice(index, 1);
    });
    await engine.flush();
    assert.equal(driver.doc("users", "u1")?.name, "Ada L.");
    assert.equal(driver.doc("users", "u2"), null);
    assert.equal(driver.ids("users").length, 21);

    await engine.mutate((db) => {
      users(db).reverse();
    });
    await engine.flush();
    assert.deepEqual(driver.ids("users"), users(await engine.getDb()).map((u) => u.id));
    assert.equal(driver.maxInFlight, 1, "persist calls never overlap");
  });

  it("serializes concurrent read-check-write mutations", async () => {
    const { driver, engine } = setup();
    await Promise.all(
      Array.from({ length: 50 }, () =>
        engine.mutate(async (db) => {
          const course = (db.courses as unknown as (Row & { seats?: number })[])[0]!;
          const seats = course.seats ?? 0;
          await delay(0);
          course.seats = seats + 1;
        }),
      ),
    );
    await engine.flush();
    assert.equal((driver.doc("courses", "c1") as Row & { seats?: number }).seats, 50);
    assert.equal(driver.maxInFlight, 1);
  });

  it("keeps changes after a failed write and stores them on the retry", async () => {
    const { driver, engine } = setup();
    driver.failNext = 1;
    await engine.mutate((db) => {
      users(db).push({ id: "r1", name: "Retry" });
    });
    assert.equal(await engine.writePending(), false);
    assert.equal(driver.doc("users", "r1"), null);
    assert.match(engine.getStats().lastError?.message ?? "", /connection lost/);
    assert.equal(await engine.writePending(), true);
    await engine.flush();
    assert.equal(driver.doc("users", "r1")?.name, "Retry");
  });

  it("stores edits made outside mutate() when settling, without an exit handler", async () => {
    const before = process.listenerCount("exit");
    const { driver, engine } = setup();
    const db = await engine.getDb();
    assert.equal(process.listenerCount("exit"), before, "an asynchronous driver cannot write from process.on('exit')");
    const kept = users(db).find((u) => u.id === "u2")!;
    kept.name = "Edited later";
    assert.equal(await engine.settle(), true);
    assert.equal(driver.doc("users", "u2")?.name, "Edited later");
  });

  it("writes outstanding changes on close() and then closes the connection", async () => {
    const { driver, engine } = setup();
    void engine.mutate((db) => {
      users(db).push({ id: "late", name: "Late" });
    });
    engines.length = 0;
    await engine.close();
    assert.equal(driver.doc("users", "late")?.name, "Late");
    assert.equal(driver.closed, true);
  });

  it("reloads after another process wrote, before the next mutation, keeping its own unsaved edits", async () => {
    const { driver, engine } = setup({ externalCheckMs: 0 });
    await engine.getDb();
    driver.externalWrite("courses", { id: "c2", title: "Written elsewhere" });
    const seen = await engine.mutate((db) => {
      users(db).push({ id: "mine", name: "Mine" });
      return (db.courses as unknown as Row[]).map((c) => c.id);
    });
    assert.deepEqual(seen, ["c1", "c2"]);
    assert.equal(engine.getStats().externalReloads, 1);
    await engine.flush();
    assert.equal(driver.doc("users", "mine")?.name, "Mine");
    assert.equal(driver.doc("courses", "c2")?.title, "Written elsewhere");
  });

  it("notices outside changes on reads too (checked in the queue)", async () => {
    const { driver, engine } = setup({ externalCheckMs: 0 });
    await engine.getDb();
    driver.externalWrite("users", { id: "x1", name: "Outside" });
    await engine.getDb();
    await engine.mutate(() => undefined);
    assert.ok(users(await engine.getDb()).some((u) => u.id === "x1"));
  });

  it("replaces everything through the driver", async () => {
    const { driver, engine } = setup();
    await engine.replaceAll({ collections: { users: [{ id: "only" }], courses: [] }, settings: { siteName: "New" } }, "test");
    assert.deepEqual(driver.ids("users"), ["only"]);
    assert.deepEqual(users(await engine.getDb()).map((u) => u.id), ["only"]);
  });
});
