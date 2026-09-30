import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { ChangeTracker, changeSetSize, fingerprint, idOf, isEmptyChangeSet } from "@/lib/db/changes";
import { StoreEngine, type EngineOptions } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import type { ChangeSet, RawData } from "@/lib/db/driver";
import { applyChanges, openDatabase, readAllData } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite item 3: change tracking. Whatever a mutation does to the
 * in-memory database (in-place edits, push, splice, whole-array
 * replacement, settings) must reach SQLite, as one transaction per flush
 * that writes only the documents that differ.
 */

interface Doc {
  id: string;
  [key: string]: unknown;
}

interface TestDb {
  users: Doc[];
  courses: Doc[];
  enrollments: Doc[];
  settings: Record<string, unknown>;
}

const COLLECTIONS = ["users", "courses", "enrollments"] as const;

let dir: string;
const engines: StoreEngine[] = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-tracking-"));
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close();
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function freshFile(): string {
  counter++;
  return path.join(dir, `case-${counter}`, "lms.sqlite");
}

function sample(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", tags: ["a"] },
        { id: "u2", email: "bob@example.com", name: "Bob", tags: [] },
        { id: "u3", email: "cy@example.com", name: "Cy", tags: [] },
      ],
      courses: [
        { id: "c1", slug: "intro", title: "Intro", chapters: [{ title: "One" }] },
        { id: "c2", slug: "next", title: "Next", chapters: [] },
      ],
      enrollments: [{ id: "e1", userId: "u1", courseId: "c1" }],
    },
    settings: { siteName: "Test site", learning: { threshold: 80 } },
  };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = data.settings ?? { siteName: "Default" };
  return db as unknown as Database;
}

interface Harness {
  engine: StoreEngine;
  driver: SqliteDriver;
  file: string;
  /** Change sets handed to the driver, one per transaction. */
  writes: ChangeSet[];
  db(): Promise<TestDb>;
  mutate<T>(fn: (db: TestDb) => T | Promise<T>): Promise<T>;
  /** Wait for the coalesced write scheduled by the last mutation. */
  settle(): Promise<void>;
  /** What the SQLite file holds, read through a separate connection. */
  stored(): TestDb;
  /** Assert that the file holds exactly what is in memory. */
  assertInSync(message?: string): Promise<void>;
}

const FLUSH_MS = 10;

function start(options: Partial<EngineOptions> & { file?: string; data?: RawData; collections?: readonly string[] } = {}): Harness {
  const file = options.file ?? freshFile();
  const collections = options.collections ?? COLLECTIONS;
  const driver = new SqliteDriver({ file, collections });
  const writes: ChangeSet[] = [];
  const persist = driver.persist.bind(driver);
  driver.persist = (data, changes) => {
    if (changes) writes.push(structuredClone(changes));
    persist(data, changes);
  };
  const engine = new StoreEngine({
    driver,
    collections,
    normalize,
    initialData: async () => options.data ?? sample(),
    flushDelayMs: FLUSH_MS,
    // Sweeps are tested on their own; keep them out of the way elsewhere.
    sweepDelayMs: 60_000,
    ...options,
  });
  engines.push(engine);
  const stored = (): TestDb => {
    const conn = openDatabase(file, { readOnly: true });
    try {
      const data = readAllData(conn, collections);
      return { ...(data.collections as unknown as Omit<TestDb, "settings">), settings: data.settings as Record<string, unknown> };
    } finally {
      conn.close();
    }
  };
  const db = async () => (await engine.getDb()) as unknown as TestDb;
  return {
    engine,
    driver,
    file,
    writes,
    db,
    mutate: (fn) => engine.mutate((d) => fn(d as unknown as TestDb)),
    settle: () => new Promise((resolve) => setTimeout(resolve, FLUSH_MS * 8)),
    stored,
    async assertInSync(message) {
      const memory = JSON.parse(JSON.stringify(engine.snapshot())) as RawData;
      const disk = stored();
      for (const name of collections) {
        assert.deepEqual((disk as unknown as Record<string, unknown>)[name], memory.collections[name], `${message ?? "storage equals memory"} (${name})`);
      }
      assert.deepEqual(disk.settings, memory.settings, `${message ?? "storage equals memory"} (settings)`);
    },
  };
}

const ids = (docs: readonly Doc[]) => docs.map((d) => d.id);
const upsertIds = (writes: ChangeSet[], name: string) => writes.flatMap((w) => w.collections.filter((c) => c.name === name).flatMap((c) => c.upserts.map((u) => u.id)));
const deleteIds = (writes: ChangeSet[], name: string) => writes.flatMap((w) => w.collections.filter((c) => c.name === name).flatMap((c) => c.deletes));

/* ------------------------------------------------------------------ */
/* ChangeTracker                                                       */
/* ------------------------------------------------------------------ */

describe("ChangeTracker", () => {
  function tracked() {
    const users: Doc[] = [
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Bob" },
      { id: "u3", name: "Cy" },
    ];
    const collections = { users };
    const tracker = new ChangeTracker();
    tracker.reset(collections, { theme: "light" });
    return { tracker, collections, users };
  }

  it("fingerprints JSON and reads document ids", () => {
    assert.equal(fingerprint('{"id":"a"}'), fingerprint('{"id":"a"}'));
    assert.notEqual(fingerprint('{"id":"a"}'), fingerprint('{"id":"b"}'));
    assert.equal(fingerprint("x").length, 28);
    assert.equal(idOf({ id: "a" }), "a");
    for (const bad of [null, undefined, "a", 5, {}, { id: "" }, { id: 7 }, []]) assert.equal(idOf(bad), null);
  });

  it("compares only the listed candidates and finds in-place edits", () => {
    const { tracker, collections, users } = tracked();
    users[0]!.name = "Ada L.";
    users[2]!.name = "Changed but not listed";
    const pending = tracker.diff(collections, [{ name: "users", mode: "candidates", candidates: [users[0], users[1]] }], undefined);
    assert.equal(pending.compared, 2);
    assert.deepEqual(pending.changeSet.collections, [{ name: "users", upserts: [{ id: "u1", json: '{"id":"u1","name":"Ada L."}' }], deletes: [] }]);
    assert.equal(pending.changeSet.settings, null);
    assert.equal(changeSetSize(pending.changeSet), 1);
  });

  it("does not move until a diff is committed, so a failed write is found again", () => {
    const { tracker, collections, users } = tracked();
    users[1]!.name = "Robert";
    const request = [{ name: "users", mode: "candidates" as const, candidates: [users[1]] }];
    const first = tracker.diff(collections, request, undefined);
    const again = tracker.diff(collections, request, undefined);
    assert.deepEqual(again.changeSet, first.changeSet);
    tracker.commit(again);
    assert.ok(isEmptyChangeSet(tracker.diff(collections, request, undefined).changeSet));
  });

  it("identity mode stores new documents, deletes missing ids and serializes nothing that kept its object", () => {
    const { tracker, users } = tracked();
    const replacement = { id: "u2", name: "Bob" };
    const next = [users[0]!, replacement, { id: "u4", name: "Di" }];
    const pending = tracker.diff({ users: next }, [{ name: "users", mode: "identity" }], undefined);
    // u1 kept its object (not serialized); u2 is a new object with equal content (serialized, not written); u4 is new.
    assert.equal(pending.compared, 2);
    assert.deepEqual(pending.changeSet.collections, [{ name: "users", upserts: [{ id: "u4", json: '{"id":"u4","name":"Di"}' }], deletes: ["u3"] }]);
    tracker.commit(pending);
    assert.equal(tracker.size("users"), 3);
    // The replacement object is now the tracked one: nothing left to compare.
    assert.equal(tracker.diff({ users: next }, [{ name: "users", mode: "identity" }], undefined).compared, 0);
  });

  it("identity mode still compares candidates that kept their object", () => {
    const { tracker, collections, users } = tracked();
    users[0]!.name = "Edited in place";
    const pending = tracker.diff(collections, [{ name: "users", mode: "identity", candidates: [users[0]] }], undefined);
    assert.deepEqual(
      pending.changeSet.collections[0]!.upserts.map((u) => u.id),
      ["u1"],
    );
  });

  it("full mode finds edits nobody reported", () => {
    const { tracker, collections, users } = tracked();
    users[2]!.name = "Silent";
    const pending = tracker.diff(collections, [{ name: "users", mode: "full" }], undefined);
    assert.equal(pending.compared, 3);
    assert.deepEqual(
      pending.changeSet.collections[0]!.upserts.map((u) => u.id),
      ["u3"],
    );
  });

  it("lets the object that is in the array win when a stale copy shares its id", () => {
    const { tracker, collections, users } = tracked();
    const stale = users[1]!;
    const replacement = { ...stale, name: "Robert" };
    users[1] = replacement;
    // The stale object is listed first, as it is when code reads a document and then replaces it.
    const pending = tracker.diff(collections, [{ name: "users", mode: "candidates", candidates: [stale, replacement] }], undefined);
    assert.deepEqual(pending.changeSet.collections, [{ name: "users", upserts: [{ id: "u2", json: '{"id":"u2","name":"Robert"}' }], deletes: [] }]);
  });

  it("merges requests for one collection: the strongest mode wins and candidates add up", () => {
    const { tracker, collections, users } = tracked();
    users[0]!.name = "A";
    users.pop();
    const pending = tracker.diff(
      collections,
      [
        { name: "users", mode: "candidates", candidates: [users[0]] },
        { name: "users", mode: "identity" },
      ],
      undefined,
    );
    assert.deepEqual(pending.changeSet.collections, [{ name: "users", upserts: [{ id: "u1", json: '{"id":"u1","name":"A"}' }], deletes: ["u3"] }]);
  });

  it("asks for rows to be renumbered only when the array order differs from the stored order", () => {
    const { tracker, users } = tracked();
    const [u1, u2, u3] = users as [Doc, Doc, Doc];
    const scan = (next: Doc[]) => tracker.diff({ users: next }, [{ name: "users", mode: "identity" }], undefined);
    assert.equal(scan([u1, u2, u3]).changeSet.collections.length, 0);
    assert.equal(scan([u1, u3]).changeSet.collections[0]!.order, undefined, "a removal keeps the order of the rest");
    assert.equal(scan([u1, u2, u3, { id: "u4" }]).changeSet.collections[0]!.order, undefined, "appended documents are stored last anyway");
    assert.deepEqual(scan([u3, u1, u2]).changeSet.collections, [{ name: "users", upserts: [], deletes: [], order: ["u3", "u1", "u2"] }]);
    const prepended = scan([{ id: "u0" }, u1, u3]);
    assert.deepEqual(prepended.changeSet.collections, [{ name: "users", upserts: [{ id: "u0", json: '{"id":"u0"}' }], deletes: ["u2"], order: ["u0", "u1", "u3"] }]);
    assert.equal(changeSetSize(prepended.changeSet), 5);
    tracker.commit(prepended);
    assert.equal(tracker.size("users"), 3);
    assert.ok(isEmptyChangeSet(tracker.diff({ users: [prepended.updates.get("users")!.set[0]![1].ref, u1, u3] }, [{ name: "users", mode: "identity" }], undefined).changeSet), "the new order is the stored order now");
  });

  it("tracks settings as one JSON value", () => {
    const { tracker, collections } = tracked();
    assert.equal(tracker.diff(collections, [], { theme: "light" }).changeSet.settings, null);
    const pending = tracker.diff(collections, [], { theme: "dark" });
    assert.equal(pending.changeSet.settings, '{"theme":"dark"}');
    tracker.commit(pending);
    assert.equal(tracker.diff(collections, [], { theme: "dark" }).changeSet.settings, null);
    assert.equal(tracker.diff(collections, [], undefined).changeSet.settings, null, "undefined means: do not compare settings");
  });

  it("counts documents without an id and repeated ids instead of storing them", () => {
    const tracker = new ChangeTracker();
    tracker.reset({ users: [] }, null);
    const users = [{ id: "u1", n: 1 }, { name: "no id" }, { id: "u1", n: 2 }];
    const scanned = tracker.diff({ users }, [{ name: "users", mode: "identity" }], undefined);
    assert.deepEqual(scanned.changeSet.collections[0]!.upserts, [{ id: "u1", json: '{"id":"u1","n":1}' }]);
    assert.equal(scanned.invalid.get("users"), 1);
    assert.equal(scanned.duplicates.get("users"), 1);
    const listed = tracker.diff({ users }, [{ name: "users", mode: "candidates", candidates: [users[1]] }], undefined);
    assert.equal(listed.invalid.get("users"), 1);
    assert.ok(isEmptyChangeSet(listed.changeSet));
  });

  it("produces change sets SQLite applies as they are", () => {
    const { tracker, collections, users } = tracked();
    const file = freshFile();
    const conn = openDatabase(file);
    try {
      conn.exec("CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK (id = 1), doc TEXT NOT NULL, updated_at TEXT NOT NULL)");
      conn.exec('CREATE TABLE "users" (id TEXT PRIMARY KEY NOT NULL, doc TEXT NOT NULL, updated_at TEXT NOT NULL)');
      const everything = new ChangeTracker().diff(collections, [{ name: "users", mode: "full" }], { theme: "light" });
      applyChanges(conn, everything.changeSet);
      users[0]!.name = "Ada L.";
      users.splice(1, 1);
      applyChanges(conn, tracker.diff(collections, [{ name: "users", mode: "identity", candidates: [users[0]] }], { theme: "dark" }).changeSet);
      assert.deepEqual(readAllData(conn, ["users"]), { collections: { users: JSON.parse(JSON.stringify(users)) }, settings: { theme: "dark" } });
    } finally {
      conn.close();
    }
  });
});

/* ------------------------------------------------------------------ */
/* StoreEngine on SQLite: round trips                                  */
/* ------------------------------------------------------------------ */

describe("StoreEngine change tracking (SQLite)", () => {
  it("stores a pushed document and nothing else", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users.push({ id: "u4", email: "di@example.com", name: "Di", tags: [] });
    });
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0]!.collections, [{ name: "users", upserts: [{ id: "u4", json: '{"id":"u4","email":"di@example.com","name":"Di","tags":[]}' }], deletes: [] }]);
    assert.equal(h.writes[0]!.settings, null);
    assert.deepEqual(ids(h.stored().users), ["u1", "u2", "u3", "u4"]);
    await h.assertInSync();
  });

  it("stores in-place edits of documents reached through find, filter, at, findIndex, findLast and an index", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users.find((u) => u.id === "u1")!.name = "Ada (find)";
      for (const u of db.users.filter((u) => u.id === "u2")) u.name = "Bob (filter)";
      db.users.at(-1)!.name = "Cy (at)";
      db.courses[db.courses.findIndex((c) => c.id === "c1")]!.title = "Intro (findIndex)";
      db.courses.findLast((c) => c.id === "c2")!.title = "Next (findLast)";
      db.enrollments[0]!.progress = 50;
    });
    await h.settle();
    assert.equal(h.writes.length, 1, "one transaction for the whole mutation");
    assert.deepEqual(upsertIds(h.writes, "users").sort(), ["u1", "u2", "u3"]);
    assert.deepEqual(upsertIds(h.writes, "courses").sort(), ["c1", "c2"]);
    assert.deepEqual(upsertIds(h.writes, "enrollments"), ["e1"]);
    assert.equal(h.stored().users[2]!.name, "Cy (at)");
    await h.assertInSync();
  });

  it("stores edits nested inside a document (arrays and objects)", async () => {
    const h = start();
    await h.mutate((db) => {
      const course = db.courses.find((c) => c.id === "c1")!;
      (course.chapters as { title: string }[]).push({ title: "Two" });
      (course.chapters as { title: string }[])[0]!.title = "One, revised";
      (db.users.find((u) => u.id === "u2")!.tags as string[]).push("vip");
    });
    await h.settle();
    assert.deepEqual(h.stored().courses[0]!.chapters, [{ title: "One, revised" }, { title: "Two" }]);
    assert.deepEqual(h.stored().users[1]!.tags, ["vip"]);
    assert.deepEqual(upsertIds(h.writes, "courses"), ["c1"]);
    await h.assertInSync();
  });

  it("stores a document replaced by a copy at the same index (the update() pattern)", async () => {
    const h = start();
    await h.mutate((db) => {
      const index = db.users.findIndex((u) => u.id === "u2");
      const current = db.users[index]!;
      db.users[index] = { ...current, name: "Robert" };
    });
    await h.settle();
    assert.deepEqual(upsertIds(h.writes, "users"), ["u2"]);
    assert.deepEqual(deleteIds(h.writes, "users"), []);
    assert.equal(h.stored().users[1]!.name, "Robert");
    await h.assertInSync();
  });

  it("deletes documents removed with splice, pop, shift and a shorter length", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users.splice(1, 1);
    });
    await h.settle();
    assert.deepEqual(deleteIds(h.writes, "users"), ["u2"]);
    assert.deepEqual(upsertIds(h.writes, "users"), [], "the documents that stayed are not rewritten");
    await h.mutate((db) => {
      db.users.pop();
      db.courses.shift();
      db.enrollments.length = 0;
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u1"]);
    assert.deepEqual(ids(h.stored().courses), ["c2"]);
    assert.deepEqual(h.stored().enrollments, []);
    await h.assertInSync();
  });

  it("stores documents inserted or swapped with splice and a replacement with another id", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users.splice(1, 1, { id: "u9", name: "Nine" });
      db.courses[0] = { id: "c9", slug: "nine", title: "Nine" };
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users).sort(), ["u1", "u3", "u9"]);
    assert.deepEqual(ids(h.stored().courses).sort(), ["c2", "c9"]);
    assert.deepEqual(deleteIds(h.writes, "users"), ["u2"]);
    assert.deepEqual(deleteIds(h.writes, "courses"), ["c1"]);
    await h.assertInSync();
  });

  it("stores whole-array replacement: filter removes, map rewrites only what changed", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users = db.users.filter((u) => u.id !== "u1");
      db.courses = db.courses.map((c) => (c.id === "c2" ? { ...c, title: "Next, renamed" } : c));
      db.enrollments = [];
    });
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(deleteIds(h.writes, "users"), ["u1"]);
    assert.deepEqual(upsertIds(h.writes, "users"), []);
    assert.deepEqual(upsertIds(h.writes, "courses"), ["c2"]);
    assert.deepEqual(deleteIds(h.writes, "enrollments"), ["e1"]);
    assert.deepEqual(ids(h.stored().users), ["u2", "u3"]);
    assert.equal(h.stored().courses[1]!.title, "Next, renamed");
    await h.assertInSync();
  });

  it("stores a replacement array built from scratch, keeping documents that did not change", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users = [
        { id: "u3", email: "cy@example.com", name: "Cy", tags: [] },
        { id: "u7", email: "new@example.com", name: "New", tags: [] },
      ];
    });
    await h.settle();
    assert.deepEqual(upsertIds(h.writes, "users"), ["u7"], "u3 has equal content and is not rewritten");
    assert.deepEqual(deleteIds(h.writes, "users").sort(), ["u1", "u2"]);
    await h.assertInSync();
  });

  it("stores edits made while iterating (for…of, forEach, map, reduce, entries, spread copies)", async () => {
    const h = start();
    await h.mutate((db) => {
      for (const u of db.users) if (u.id === "u1") u.name = "for-of";
      db.courses.forEach((c) => {
        if (c.id === "c2") c.title = "forEach";
      });
    });
    await h.settle();
    assert.deepEqual(upsertIds(h.writes, "users"), ["u1"]);
    assert.deepEqual(upsertIds(h.writes, "courses"), ["c2"]);
    await h.mutate((db) => {
      const byId = new Map(db.users.map((u) => [u.id, u]));
      byId.get("u2")!.name = "map";
      [...db.courses][0]!.title = "spread";
      for (const [, e] of db.enrollments.entries()) e.progress = 10;
      db.users.slice(2)[0]!.name = "slice";
    });
    await h.settle();
    const disk = h.stored();
    assert.deepEqual(
      disk.users.map((u) => u.name),
      ["for-of", "map", "slice"],
    );
    assert.equal(disk.courses[0]!.title, "spread");
    assert.equal(disk.enrollments[0]!.progress, 10);
    await h.assertInSync();
  });

  it("stores settings edited in place and replaced", async () => {
    const h = start();
    await h.mutate((db) => {
      (db.settings.learning as { threshold: number }).threshold = 95;
    });
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(h.writes[0]!.collections, []);
    assert.deepEqual(h.stored().settings, { siteName: "Test site", learning: { threshold: 95 } });
    await h.mutate((db) => {
      db.settings = { siteName: "Replaced" };
    });
    await h.settle();
    assert.deepEqual(h.stored().settings, { siteName: "Replaced" });
    assert.equal(h.writes.length, 2);
  });

  it("writes nothing when a mutation only reads", async () => {
    const h = start();
    const total = await h.mutate((db) => db.users.filter((u) => u.name).length + db.courses.map((c) => c.id).length + (db.users.some((u) => u.id === "u1") ? 1 : 0));
    assert.equal(total, 6);
    await h.settle();
    assert.deepEqual(h.writes, []);
    assert.equal(h.engine.getStats().pending, false);
  });

  it("coalesces a burst of mutations into one transaction", async () => {
    const h = start();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        h.mutate((db) => {
          db.enrollments.push({ id: `burst-${i}`, userId: "u1", courseId: "c1" });
          db.users.find((u) => u.id === "u1")!.lastSeen = i;
        }),
      ),
    );
    await h.settle();
    assert.equal(h.writes.length, 1, "one transaction");
    assert.equal(upsertIds(h.writes, "enrollments").length, 40);
    assert.deepEqual(upsertIds(h.writes, "users"), ["u1"], "a document edited 40 times is written once");
    assert.equal(h.stored().users[0]!.lastSeen, 39);
    assert.equal(h.engine.getStats().flushes, 1);
    await h.assertInSync();
  });

  it("keeps array order across restarts: appends, unshift, splice-insert, sort, reverse, reordered replacement", async () => {
    const h = start();
    await h.mutate((db) => {
      db.users.push({ id: "u0", name: "Last in" });
      db.users.find((u) => u.id === "u1")!.name = "Edited first";
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["u1", "u2", "u3", "u0"], "an edited row keeps its place, a new one goes last");
    assert.ok(h.writes.every((w) => w.collections.every((c) => !c.order)), "appending renumbers nothing");

    await h.mutate((db) => {
      db.users.unshift({ id: "first", name: "Newest first" });
      db.users.splice(2, 0, { id: "middle", name: "In the middle" });
      db.courses.reverse();
      db.enrollments.push({ id: "e0", userId: "u2", courseId: "c2" });
      db.enrollments.sort((a, b) => a.id.localeCompare(b.id));
    });
    await h.settle();
    assert.deepEqual(ids(h.stored().users), ["first", "u1", "middle", "u2", "u3", "u0"]);
    assert.deepEqual(ids(h.stored().courses), ["c2", "c1"]);
    assert.deepEqual(ids(h.stored().enrollments), ["e0", "e1"]);
    await h.assertInSync();

    await h.mutate((db) => {
      db.users = [...db.users].sort((a, b) => a.id.localeCompare(b.id)).filter((u) => u.id !== "middle");
    });
    await h.settle();
    assert.deepEqual(h.writes.at(-1)!.collections, [{ name: "users", upserts: [], deletes: ["middle"], order: ["first", "u0", "u1", "u2", "u3"] }]);

    h.engine.close();
    const again = start({ file: h.file });
    const db = await again.db();
    assert.equal(again.engine.getStats().origin, "existing");
    assert.deepEqual(ids(db.users), ["first", "u0", "u1", "u2", "u3"]);
    assert.deepEqual(ids(db.courses), ["c2", "c1"]);
    assert.deepEqual(ids(db.enrollments), ["e0", "e1"]);
    // The reopened engine knows the stored order: another append renumbers nothing.
    await again.mutate((d) => {
      d.users.push({ id: "zz", name: "Appended after the restart" });
      d.users.splice(1, 1);
    });
    await again.settle();
    assert.deepEqual(again.writes.at(-1)!.collections, [{ name: "users", upserts: [{ id: "zz", json: '{"id":"zz","name":"Appended after the restart"}' }], deletes: ["u0"] }]);
    await again.assertInSync();
  });

  it("runs mutations one at a time, in call order, even when callbacks are asynchronous", async () => {
    const h = start();
    const order: string[] = [];
    const reserve = (who: string) =>
      h.mutate(async (db) => {
        order.push(`${who}:start`);
        const course = db.courses.find((c) => c.id === "c1")!;
        const seats = (course.seats as number | undefined) ?? 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`${who}:end`);
        if (seats <= 0) return false;
        course.seats = seats - 1;
        return true;
      });
    const results = await Promise.all([reserve("a"), reserve("b"), reserve("c")]);
    assert.deepEqual(results, [true, false, false], "read-check-write is atomic: one seat, one winner");
    assert.deepEqual(order, ["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]);
    await h.settle();
    assert.equal(h.stored().courses[0]!.seats, 0);
  });

  it("does not record reads made by other code while an asynchronous mutation is waiting", async () => {
    const h = start();
    const db = await h.db();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const running = h.mutate(async (d) => {
      d.users.find((u) => u.id === "u1")!.name = "Inside";
      await gate;
    });
    await new Promise((resolve) => setImmediate(resolve));
    // A request rendering a page meanwhile: reads, but is not part of the mutation.
    const before = h.engine.getStats().documentsCompared;
    assert.equal(db.courses.map((c) => c.title).length, 2);
    assert.ok(db.users.find((u) => u.id === "u3"));
    release();
    await running;
    await h.settle();
    assert.deepEqual(upsertIds(h.writes, "users"), ["u1"]);
    assert.equal(h.engine.getStats().documentsCompared - before, 1, "only the document the mutation touched was compared");
  });

  it("stores what a mutation changed before it threw, and keeps the queue going", async () => {
    const h = start();
    await assert.rejects(
      h.mutate((db) => {
        db.users.find((u) => u.id === "u1")!.name = "Half done";
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.equal(await h.mutate((db) => db.users.length), 3);
    await h.settle();
    assert.equal(h.stored().users[0]!.name, "Half done");
    await h.assertInSync();
  });

  it("stores array writes made outside mutate() at the next coalesced flush", async () => {
    const h = start();
    const db = await h.db();
    db.users.push({ id: "u5", name: "Outside" });
    db.courses.splice(0, 1);
    db.enrollments = [];
    await h.settle();
    assert.equal(h.writes.length, 1);
    assert.deepEqual(ids(h.stored().users), ["u1", "u2", "u3", "u5"]);
    assert.deepEqual(ids(h.stored().courses), ["c2"]);
    assert.deepEqual(h.stored().enrollments, []);
    await h.assertInSync();
  });

  it("compares only what a mutation touched, however large the collection", async () => {
    const big: Doc[] = Array.from({ length: 5000 }, (_, i) => ({ id: `w${i}`, userId: `u${i % 50}`, seconds: 0 }));
    const h = start({ data: { collections: { users: big, courses: [], enrollments: [] }, settings: {} } });
    await h.db();
    const before = h.engine.getStats().documentsCompared;
    // The heartbeat shape: find one row (or push it), edit it in place; plus pure membership tests.
    await h.mutate((db) => {
      const row = db.users.find((w) => w.id === "w4321")!;
      row.seconds = 30;
      if (!db.users.some((w) => w.id === "w-new")) db.users.push({ id: "w-new", userId: "u1", seconds: 1 });
      assert.equal(db.users.includes(row), true);
      assert.equal(db.users.every((w) => typeof w.id === "string"), true);
      assert.equal(db.users.indexOf(row), 4321);
    });
    await h.settle();
    assert.equal(h.engine.getStats().documentsCompared - before, 2);
    assert.deepEqual(upsertIds(h.writes, "users").sort(), ["w-new", "w4321"]);
    // update()/remove() shapes on the same collection.
    await h.mutate((db) => {
      const index = db.users.findIndex((w) => w.id === "w4999");
      db.users[index] = { ...db.users[index]!, seconds: 99 };
      db.users.splice(db.users.findIndex((w) => w.id === "w10"), 1);
    });
    await h.settle();
    assert.ok(h.engine.getStats().documentsCompared - before <= 5, "removal compares ids, not documents");
    assert.deepEqual(deleteIds(h.writes, "users"), ["w10"]);
    const disk = h.stored().users;
    assert.equal(disk.length, 5000);
    assert.equal(disk.find((w) => w.id === "w4999")!.seconds, 99);
    assert.equal(disk.find((w) => w.id === "w4321")!.seconds, 30);
  });

  it("keeps trying after a failed write and loses nothing", async () => {
    const h = start();
    await h.db();
    const persist = h.driver.persist;
    let failures = 0;
    h.driver.persist = () => {
      failures++;
      throw Object.assign(new Error("database is locked"), { errcode: 5 });
    };
    const errors: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    try {
      await h.mutate((db) => {
        db.users.find((u) => u.id === "u1")!.name = "Survives a failure";
        db.users.splice(2, 1);
      });
      await h.settle();
      assert.equal(failures, 1);
      assert.equal(h.stored().users[0]!.name, "Ada", "nothing was written");
      const stats = h.engine.getStats();
      assert.equal(stats.pending, true);
      assert.match(stats.lastError?.message ?? "", /locked by another process/);
      assert.equal(errors.length, 1);
    } finally {
      console.error = original;
      h.driver.persist = persist;
    }
    await h.engine.flush();
    assert.equal(h.stored().users[0]!.name, "Survives a failure");
    assert.deepEqual(ids(h.stored().users), ["u1", "u2"]);
    assert.equal(h.engine.getStats().pending, false);
    await h.assertInSync();
  });
});

/* ------------------------------------------------------------------ */
/* Edits the engine cannot see                                         */
/* ------------------------------------------------------------------ */

describe("StoreEngine safety nets (SQLite)", () => {
  function quiet<T>(fn: (warnings: string[]) => Promise<T>): Promise<T> {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(" "));
    return fn(warnings).finally(() => {
      console.warn = original;
    });
  }

  it("flush() stores edits made on a document fetched before the mutation", async () => {
    const h = start();
    const db = await h.db();
    const user = db.users.find((u) => u.id === "u2")!; // fetched outside mutate()
    await h.mutate(() => {
      user.name = "Edited through an old reference";
    });
    await h.settle();
    assert.deepEqual(h.writes, [], "the coalesced flush could not know about it");
    await h.engine.flush();
    assert.equal(h.stored().users[1]!.name, "Edited through an old reference");
    await h.assertInSync();
  });

  it("the background sweep stores such edits by itself and reports them", async () => {
    await quiet(async (warnings) => {
      const h = start({ sweepDelayMs: 20, sweepSliceMs: 1 });
      const db = await h.db();
      const user = db.users.find((u) => u.id === "u3")!;
      user.name = "Edited outside mutate";
      (db.settings as Record<string, unknown>).siteName = "Edited outside mutate";
      assert.equal(db.courses.length, 2);
      // The array itself, as code holding it from before the engine wrapped it would.
      const raw = h.engine.snapshot()!.collections.courses as Doc[];
      raw.push({ id: "c-raw", title: "Added behind the store's back" });
      raw.shift();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const disk = h.stored();
      assert.equal(disk.users[2]!.name, "Edited outside mutate");
      assert.equal(disk.settings.siteName, "Edited outside mutate");
      assert.deepEqual(ids(disk.courses), ["c2", "c-raw"]);
      assert.equal(h.engine.getStats().untrackedWrites, 4);
      assert.ok(h.engine.getStats().lastSweepAt);
      assert.ok(warnings.some((w) => /"users".*could not see/.test(w)));
      await h.assertInSync();
    });
  });

  it("the sweep leaves tracked changes to the normal flush and reports nothing for them", async () => {
    await quiet(async (warnings) => {
      const h = start({ sweepDelayMs: 15, sweepSliceMs: 1 });
      for (let i = 0; i < 5; i++) {
        await h.mutate((db) => {
          db.users.find((u) => u.id === "u1")!.visits = i;
          db.enrollments.push({ id: `s${i}`, userId: "u1", courseId: "c2" });
        });
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(h.engine.getStats().untrackedWrites, 0);
      assert.deepEqual(warnings, []);
      assert.equal(h.stored().users[0]!.visits, 4);
      await h.assertInSync();
    });
  });

  it("close() stores everything outstanding, including edits nobody reported", async () => {
    const h = start();
    const db = await h.db();
    await h.mutate((d) => {
      d.users.push({ id: "u8", name: "Pending at close" });
    });
    db.courses.find((c) => c.id === "c1")!.title = "Edited outside, never flushed";
    h.engine.close();
    const disk = h.stored();
    assert.deepEqual(ids(disk.users), ["u1", "u2", "u3", "u8"]);
    assert.equal(disk.courses[0]!.title, "Edited outside, never flushed");
    assert.ok(!fs.existsSync(`${h.file}-wal`) || fs.statSync(`${h.file}-wal`).size === 0, "the WAL was folded into the main file");
  });

  it("warns about documents that cannot be stored (no id) and keeps storing the rest", async () => {
    await quiet(async (warnings) => {
      const h = start();
      await h.mutate((db) => {
        db.users.push({ name: "No id" } as unknown as Doc, { id: "u6", name: "Fine" });
      });
      await h.settle();
      assert.deepEqual(ids(h.stored().users), ["u1", "u2", "u3", "u6"]);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0]!, /"users" have no id/);
    });
  });
});

/* ------------------------------------------------------------------ */
/* What callers see                                                    */
/* ------------------------------------------------------------------ */

describe("StoreEngine collections (SQLite)", () => {
  it("hands out one stable array per collection, inside and outside mutations", async () => {
    const h = start();
    const db = await h.db();
    const users = db.users;
    assert.equal(db.users, users);
    assert.ok(Array.isArray(users));
    assert.ok(users instanceof Array);
    assert.equal(users.length, 3);
    const inside = await h.mutate((d) => d.users);
    assert.equal(inside, users, "caches keyed on the array stay valid across mutations");
    await h.mutate((d) => {
      d.users.push({ id: "u4", name: "Di" });
    });
    assert.equal(db.users, users, "appending keeps the array");
    assert.equal(users.length, 4);
    await h.mutate((d) => {
      d.users = d.users.filter((u) => u.id !== "u4");
    });
    assert.notEqual(db.users, users, "replacing the array gives a new one");
    assert.equal(db.users.length, 3);
    assert.equal((await h.db()).users, db.users);
  });

  it("behaves like a plain array for reading code", async () => {
    const h = start();
    const { users, courses } = await h.db();
    assert.deepEqual(ids(users), ["u1", "u2", "u3"]);
    assert.deepEqual(ids([...users]), ["u1", "u2", "u3"]);
    assert.deepEqual(Array.from(users, (u) => u.id), ["u1", "u2", "u3"]);
    const [first, ...rest] = users;
    assert.equal(first!.id, "u1");
    assert.equal(rest.length, 2);
    assert.equal(users.find((u) => u.id === "u2"), users[1]);
    assert.equal(users.at(-1), users[2]);
    assert.equal(users.indexOf(users[2]!), 2);
    assert.equal(users.includes(users[0]!), true);
    assert.equal(users.findIndex((u) => u.id === "missing"), -1);
    assert.equal(users.some((u) => u.id === "u3"), true);
    assert.equal(users.every((u) => u.id.startsWith("u")), true);
    assert.deepEqual(ids(users.filter((u) => u.id !== "u2")), ["u1", "u3"]);
    assert.deepEqual(ids(users.slice(1)), ["u2", "u3"]);
    assert.deepEqual(ids(users.concat(courses)), ["u1", "u2", "u3", "c1", "c2"]);
    assert.deepEqual(ids(([] as Doc[]).concat(users)), ["u1", "u2", "u3"]);
    assert.deepEqual(ids(users.toSorted((a, b) => b.id.localeCompare(a.id))), ["u3", "u2", "u1"]);
    assert.equal(users.reduce((n, u) => n + u.id.length, 0), 6);
    assert.deepEqual([...users.keys()], [0, 1, 2]);
    assert.deepEqual(Object.keys(users), ["0", "1", "2"]);
    assert.equal(JSON.stringify(users), JSON.stringify(h.engine.snapshot()!.collections.users));
    // Documents are the real objects, never wrappers.
    assert.equal(users[0], (h.engine.snapshot()!.collections.users as Doc[])[0]);
    assert.doesNotThrow(() => structuredClone(users[0]));
  });

  it("keeps the database object valid when everything is replaced", async () => {
    const h = start();
    const db = await h.db();
    await h.mutate((d) => {
      d.users.push({ id: "u4", name: "Soon gone" });
    });
    await h.engine.replaceAll({ collections: { users: [{ id: "r1", name: "Restored" }] }, settings: { siteName: "Restored site" } }, "test-restore");
    assert.deepEqual(ids(db.users), ["r1"], "the object returned earlier shows the new contents");
    assert.deepEqual(db.courses, []);
    assert.equal(db.settings.siteName, "Restored site");
    assert.equal(await h.db(), db);
    assert.deepEqual(ids(h.stored().users), ["r1"]);
    await h.mutate((d) => {
      d.users.find((u) => u.id === "r1")!.name = "Edited after restore";
    });
    await h.settle();
    assert.equal(h.stored().users[0]!.name, "Edited after restore");
    await h.assertInSync();
  });

  it("gives exclusive() a fully written database", async () => {
    const h = start();
    const db = await h.db();
    db.users.find((u) => u.id === "u1")!.name = "Unreported edit";
    void h.mutate((d) => {
      d.courses.push({ id: "c3", title: "Queued before the exclusive call" });
    });
    const seen = await h.engine.exclusive((ctx) => {
      const disk = h.stored();
      return { name: disk.users[0]!.name, courses: ids(disk.courses), live: ids(ctx.data().collections.courses as Doc[]) };
    });
    assert.deepEqual(seen, { name: "Unreported edit", courses: ["c1", "c2", "c3"], live: ["c1", "c2", "c3"] });
  });

  it("reloads after another process wrote to the file, keeping its own unsaved edits", async () => {
    const h = start({ externalCheckMs: 0 });
    const db = await h.db();
    await h.mutate((d) => {
      d.users.find((u) => u.id === "u1")!.name = "Mine, not flushed yet";
    });
    const other = openDatabase(h.file);
    try {
      applyChanges(other, {
        collections: [
          { name: "courses", upserts: [{ id: "c7", json: '{"id":"c7","title":"From outside"}' }], deletes: ["c1"] },
          { name: "users", upserts: [{ id: "u2", json: '{"id":"u2","name":"Changed outside"}' }], deletes: [] },
        ],
        settings: null,
      });
    } finally {
      other.close();
    }
    const info = console.info;
    console.info = () => undefined;
    try {
      assert.deepEqual(await h.mutate((d) => ids(d.courses)), ["c2", "c7"]);
    } finally {
      console.info = info;
    }
    assert.equal(h.engine.getStats().externalReloads, 1);
    assert.equal(db.users.find((u) => u.id === "u1")!.name, "Mine, not flushed yet");
    assert.equal(db.users.find((u) => u.id === "u2")!.name, "Changed outside");
    assert.equal(h.stored().users[0]!.name, "Mine, not flushed yet");
    await h.engine.flush();
    await h.assertInSync();
  });

  it("stores collections adopted after the engine started", async () => {
    const h = start();
    await h.db();
    h.engine.adoptCollections(["users", "badges"]);
    const db = (await h.engine.getDb()) as unknown as Record<string, Doc[]>;
    assert.deepEqual(db.badges, []);
    await h.engine.mutate((d) => {
      (d as unknown as Record<string, Doc[]>).badges!.push({ id: "b1", name: "First" });
    });
    await h.engine.flush();
    const conn = openDatabase(h.file, { readOnly: true });
    try {
      assert.deepEqual(readAllData(conn, ["badges"]).collections.badges, [{ id: "b1", name: "First" }]);
    } finally {
      conn.close();
    }
  });
});
