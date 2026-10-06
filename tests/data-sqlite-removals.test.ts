import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine, type EngineOptions } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import type { ChangeSet, RawData } from "@/lib/db/driver";
import { openDatabase, readAllData } from "@/lib/db/sqlite-core.mjs";

/**
 * Review fix (data-sqlite, round 3): deleting documents costs what was
 * deleted, not the size of the collection. `splice`/`pop`/`shift`/shorter
 * `length`, `removeWhere()` and the `db.x = db.x.filter(keep)` idiom record
 * the removed documents and the write deletes their ids without serializing
 * the documents that stayed. Every ambiguous case (a document put back, a
 * reordered filter result, a copy sharing an id) still ends with storage
 * equal to memory, including the order of the rows.
 *
 * Also: `settle()` (used by backups and restores) compares the database in
 * short slices instead of one long pass.
 */

interface Doc {
  id: string;
  [key: string]: unknown;
}

interface TestDb {
  users: Doc[];
  sessions: Doc[];
  settings: Record<string, unknown>;
}

const COLLECTIONS = ["users", "sessions"] as const;
const FLUSH_MS = 10;
const BIG = 5000;

let dir: string;
let counter = 0;
const engines: StoreEngine[] = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-removals-"));
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function bigData(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Bob" },
        { id: "u3", name: "Cy" },
        { id: "u4", name: "Di" },
      ],
      sessions: Array.from({ length: BIG }, (_, i) => ({ id: `s${i}`, userId: `u${(i % 4) + 1}`, expiresAt: i % 10 === 0 ? "2000-01-01" : "2999-01-01" })),
    },
    settings: { siteName: "Removals" },
  };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = data.settings ?? {};
  return db as unknown as Database;
}

function start(options: Partial<EngineOptions> & { file?: string; data?: RawData } = {}) {
  counter++;
  const file = options.file ?? path.join(dir, `case-${counter}`, "lms.sqlite");
  const driver = new SqliteDriver({ file, collections: COLLECTIONS });
  const writes: ChangeSet[] = [];
  const persist = driver.persist.bind(driver);
  driver.persist = (data, changes) => {
    if (changes) writes.push(structuredClone(changes));
    persist(data, changes);
  };
  const engine = new StoreEngine({
    driver,
    collections: COLLECTIONS,
    normalize,
    initialData: async () => options.data ?? bigData(),
    flushDelayMs: FLUSH_MS,
    sweepDelayMs: 60_000,
    ...options,
  });
  engines.push(engine);
  const stored = (): TestDb => {
    const conn = openDatabase(file, { readOnly: true });
    try {
      const data = readAllData(conn, COLLECTIONS);
      return { ...(data.collections as unknown as Omit<TestDb, "settings">), settings: data.settings as Record<string, unknown> };
    } finally {
      conn.close();
    }
  };
  return {
    engine,
    driver,
    file,
    writes,
    db: async () => (await engine.getDb()) as unknown as TestDb,
    mutate: <T>(fn: (db: TestDb) => T | Promise<T>) => engine.mutate((d) => fn(d as unknown as TestDb)),
    /** Wait for the coalesced write. */
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, FLUSH_MS * 8)),
    compared: () => engine.getStats().documentsCompared,
    stored,
    assertInSync() {
      const memory = JSON.parse(JSON.stringify(engine.snapshot())) as RawData;
      const disk = stored();
      for (const name of COLLECTIONS) assert.deepEqual((disk as unknown as Record<string, unknown>)[name], memory.collections[name], `storage equals memory (${name})`);
      assert.deepEqual(disk.settings, memory.settings);
    },
  };
}

const ids = (docs: readonly Doc[]) => docs.map((d) => d.id);
const upserts = (writes: ChangeSet[], name: string) => writes.flatMap((w) => w.collections.filter((c) => c.name === name).flatMap((c) => c.upserts.map((u) => u.id)));
const deletes = (writes: ChangeSet[], name: string) => writes.flatMap((w) => w.collections.filter((c) => c.name === name).flatMap((c) => c.deletes));
const renumbered = (writes: ChangeSet[], name: string) => writes.some((w) => w.collections.some((c) => c.name === name && c.order));

describe("deleting documents writes only the deletions", () => {
  it("db.x = db.x.filter(keep) deletes the removed ids without comparing the documents that stayed", async () => {
    const h = start();
    await h.db();
    const before = h.compared();
    const removed = await h.mutate((db) => {
      const count = db.sessions.length;
      db.sessions = db.sessions.filter((s) => s.userId !== "u2");
      return count - db.sessions.length;
    });
    await h.settle();
    assert.equal(removed, BIG / 4);
    assert.equal(h.compared() - before, 0, "no surviving document was serialized");
    assert.equal(deletes(h.writes, "sessions").length, BIG / 4);
    assert.deepEqual(upserts(h.writes, "sessions"), []);
    assert.equal(renumbered(h.writes, "sessions"), false);
    h.assertInSync();
  });

  it("a filter result assigned later (the retention shape) is also a removal", async () => {
    const h = start();
    await h.db();
    const before = h.compared();
    await h.mutate((db) => {
      const kept = db.sessions.filter((s) => s.expiresAt !== "2000-01-01");
      const users = db.users.filter((u) => u.id !== "u4");
      if (kept.length !== db.sessions.length) db.sessions = kept;
      db.users = users;
    });
    await h.settle();
    assert.equal(h.compared() - before, 0);
    assert.equal(deletes(h.writes, "sessions").length, BIG / 10);
    assert.deepEqual(deletes(h.writes, "users"), ["u4"]);
    h.assertInSync();
  });

  it("removeWhere() compacts the same array in place and deletes only what matched", async () => {
    const h = start();
    const db = await h.db();
    const array = db.sessions;
    const before = h.compared();
    const removed = await h.engine.removeWhere("sessions", (s) => (s as Doc).userId === "u3");
    await h.settle();
    assert.equal(removed, BIG / 4);
    assert.equal(db.sessions, array, "the collection keeps its array");
    assert.equal(db.sessions.length, BIG - BIG / 4);
    assert.ok(db.sessions.every((s) => s.userId !== "u3"));
    assert.equal(h.compared() - before, 0);
    assert.equal(deletes(h.writes, "sessions").length, BIG / 4);
    assert.equal(renumbered(h.writes, "sessions"), false);
    h.assertInSync();

    assert.equal(await h.engine.removeWhere("sessions", () => false), 0);
    await assert.rejects(
      h.engine.removeWhere("sessions", (s) => {
        if ((s as Doc).id === "s100") throw new Error("predicate failed");
        return (s as Doc).userId === "u1";
      }),
      /predicate failed/,
    );
    assert.equal(db.sessions.length, BIG - BIG / 4, "a throwing predicate removes nothing");
  });

  it("splice, pop, shift and a shorter length delete by id and compare nothing", async () => {
    const h = start();
    await h.db();
    const before = h.compared();
    await h.mutate((db) => {
      db.sessions.splice(db.sessions.findIndex((s) => s.id === "s2500"), 1);
      db.sessions.pop();
      db.sessions.shift();
      db.sessions.length = db.sessions.length - 2;
    });
    await h.settle();
    // findIndex records the document it found; it is removed, so it is not compared either.
    assert.equal(h.compared() - before, 0);
    assert.deepEqual(deletes(h.writes, "sessions").sort(), ["s0", "s2500", `s${BIG - 1}`, `s${BIG - 2}`, `s${BIG - 3}`].sort());
    assert.equal(renumbered(h.writes, "sessions"), false);
    h.assertInSync();
  });

  it("splice(i, 1, copy) with the same id is an update in place", async () => {
    const h = start();
    await h.db();
    await h.mutate((db) => {
      const index = db.users.findIndex((u) => u.id === "u2");
      db.users.splice(index, 1, { ...db.users[index]!, name: "Robert" });
    });
    await h.settle();
    assert.deepEqual(upserts(h.writes, "users"), ["u2"]);
    assert.deepEqual(deletes(h.writes, "users"), []);
    assert.equal(renumbered(h.writes, "users"), false);
    h.assertInSync();
  });

  it("still stores edits made in the same mutation through find, and through a filter result that was not assigned", async () => {
    const h = start();
    await h.db();
    const before = h.compared();
    await h.mutate((db) => {
      db.users.find((u) => u.id === "u1")!.name = "Ada L.";
      // s7 belongs to u4 (removed just after), s8 to u1 (kept).
      for (const s of db.sessions.filter((x) => x.id === "s7" || x.id === "s8")) s.touched = true;
      db.sessions = db.sessions.filter((s) => s.userId !== "u4");
      db.users = db.users.filter((u) => u.id !== "u3");
    });
    await h.settle();
    assert.deepEqual(upserts(h.writes, "users"), ["u1"]);
    assert.deepEqual(deletes(h.writes, "users"), ["u3"]);
    assert.deepEqual(upserts(h.writes, "sessions"), ["s8"]);
    assert.ok(deletes(h.writes, "sessions").includes("s7"));
    assert.equal(h.compared() - before, 2, "only the two edited documents that stayed were compared");
    assert.equal(h.stored().sessions.find((s) => s.id === "s8")!.touched, true);
    h.assertInSync();
  });
});

describe("ambiguous removals fall back to a full membership check", () => {
  it("a document removed and pushed back (moved to the end) is stored in its new place", async () => {
    const h = start();
    await h.mutate((db) => {
      const index = db.users.findIndex((u) => u.id === "u1");
      const [doc] = db.users.splice(index, 1);
      db.users.push(doc!);
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u2", "u3", "u4", "u1"]);
    h.assertInSync();
  });

  it("a document removed and replaced by a copy with the same id at the end is kept, in order", async () => {
    const h = start();
    await h.mutate((db) => {
      const index = db.users.findIndex((u) => u.id === "u2");
      const [old] = db.users.splice(index, 1);
      db.users.push({ ...old!, name: "Moved Bob" });
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u1", "u3", "u4", "u2"]);
    assert.equal(h.stored().users.at(-1)!.name, "Moved Bob");
    h.assertInSync();
  });

  it("a filter result that gained a new document is stored with it", async () => {
    const h = start();
    await h.mutate((db) => {
      const kept = db.users.filter((u) => u.id !== "u1");
      kept.push({ id: "u9", name: "New" });
      db.users = kept;
    });
    await h.settle();
    assert.deepEqual(deletes(h.writes, "users"), ["u1"]);
    assert.deepEqual(upserts(h.writes, "users"), ["u9"]);
    assert.deepEqual(ids(h.stored().users), ["u2", "u3", "u4", "u9"]);
    h.assertInSync();
  });

  it("a filter result that was reordered before being assigned is stored in its new order", async () => {
    const h = start();
    await h.mutate((db) => {
      const kept = db.users.filter((u) => u.id !== "u2");
      kept.reverse();
      db.users = kept;
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u4", "u3", "u1"]);
    h.assertInSync();
  });

  it("a filter result whose first kept document was taken out is still a plain removal", async () => {
    const h = start();
    await h.mutate((db) => {
      const kept = db.users.filter((u) => u.id !== "u4");
      kept.shift();
      db.users = kept;
    });
    await h.settle();
    assert.deepEqual(deletes(h.writes, "users").sort(), ["u1", "u4"]);
    assert.deepEqual(ids(h.stored().users), ["u2", "u3"]);
    h.assertInSync();
  });

  it("a stale copy of a document cannot delete the stored one", async () => {
    const h = start();
    await h.mutate((db) => {
      const index = db.users.findIndex((u) => u.id === "u3");
      db.users[index] = { ...db.users[index]!, name: "Replaced" };
    });
    await h.settle();
    // The array holds the replacement; push a second copy sharing its id, then remove that copy.
    await h.mutate((db) => {
      db.users.push({ id: "u3", name: "Duplicate" });
      db.users.pop();
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u1", "u2", "u3", "u4"]);
    assert.equal(h.stored().users[2]!.name, "Replaced");
    h.assertInSync();
  });

  it("keeps a removal recorded when the write fails, and stores it on the next tracked write", async () => {
    const h = start();
    await h.db();
    const persist = h.driver.persist;
    let failures = 0;
    h.driver.persist = () => {
      failures++;
      throw Object.assign(new Error("database is locked"), { errcode: 5 });
    };
    const original = console.error;
    console.error = () => undefined;
    try {
      await h.mutate((db) => {
        db.sessions = db.sessions.filter((s) => s.id !== "s1");
        db.sessions.splice(0, 1);
      });
      assert.equal(await h.engine.writePending(), false);
      assert.ok(failures >= 1);
    } finally {
      console.error = original;
      h.driver.persist = persist;
    }
    const before = h.compared();
    assert.equal(await h.engine.writePending(), true);
    assert.equal(h.compared() - before, 0);
    assert.equal(h.stored().sessions.length, BIG - 2);
    h.assertInSync();
  });

  it("survives a restart with the right rows after many mixed removals", async () => {
    const h = start();
    await h.mutate((db) => {
      db.sessions = db.sessions.filter((s) => s.userId !== "u1");
      db.sessions.splice(10, 5);
      db.sessions.push({ id: "late", userId: "u2", expiresAt: "2999-01-01" });
      db.sessions.shift();
    });
    await h.engine.removeWhere("sessions", (s) => (s as Doc).expiresAt === "2000-01-01");
    await h.settle();
    const expected = ids((await h.db()).sessions);
    h.engine.close();
    engines.splice(engines.indexOf(h.engine), 1);
    const again = start({ file: h.file });
    assert.deepEqual(ids((await again.db()).sessions), expected);
  });
});

describe("settle()", () => {
  it("writes everything, including edits the engine could not see, in short slices", async () => {
    const h = start({ sweepSliceMs: 0 });
    const db = await h.db();
    // An edit made outside mutate(): only a comparison finds it.
    db.sessions[BIG - 1]!.expiresAt = "edited outside";
    let slices = 0;
    let mutation: Promise<void> | null = null;
    let doneAfterSlices = Infinity;
    const engine = h.engine as unknown as { sweepSlice: (...args: unknown[]) => unknown };
    const slice = engine.sweepSlice.bind(h.engine);
    engine.sweepSlice = (...args: unknown[]) => {
      slices++;
      // A mutation started while settle() compares is served between two slices, not after all of them.
      if (slices === 2) {
        mutation = h.mutate((d) => void d.users.push({ id: "during", name: "During settle" })).then(() => {
          doneAfterSlices = slices;
        });
      }
      return slice(...args);
    };
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      assert.equal(await h.engine.settle(), true);
      await mutation;
    } finally {
      console.warn = warn;
    }
    assert.ok(slices > 5, `compared in many slices (${slices})`);
    assert.ok(doneAfterSlices < slices, `the mutation ran after slice ${doneAfterSlices} of ${slices}`);
    assert.equal(h.stored().sessions[BIG - 1]!.expiresAt, "edited outside");
    assert.ok(ids(h.stored().users).includes("during"));
    h.assertInSync();
  });

  it("waits for a sweep that is already running, then compares everything", async () => {
    const h = start();
    const db = await h.db();
    db.users[0]!.name = "Unreported";
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const running = h.engine.sweepNow(["sessions"]);
      assert.equal(await h.engine.settle(), true);
      await running;
    } finally {
      console.warn = warn;
    }
    assert.equal(h.stored().users[0]!.name, "Unreported");
  });
});
