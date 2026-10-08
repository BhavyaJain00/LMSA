import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import { PostgresDriver, sharedPrismaClient } from "@/lib/db/postgres";
import { countRows, readAllData, writeAllData, bumpWriteSeq, countMismatches, expectedCounts } from "@/lib/db/postgres-core.mjs";
import type { RawData } from "@/lib/db/driver";
import { BackupManager } from "@/lib/db/backup";
import { readSourceDatabase } from "../scripts/lib/sqlite-source.mjs";
import { replaceDatabase } from "../scripts/lib/pg.mjs";
import { PG_SKIP, createTestSchema, dropTestSchemas } from "./helpers/postgres";
import { createLegacySqlite } from "./helpers/legacy-sqlite";

/**
 * The PostgreSQL driver against a real PostgreSQL server, through the store
 * engine. Runs only when TEST_DATABASE_URL is set (`npm run test:pg`,
 * see tests/helpers/postgres.ts); every case gets its own temporary schema.
 */

if (PG_SKIP) console.log(`# ${PG_SKIP}`);

const COLLECTIONS = ["users", "courses", "progress", "enrollments"] as const;
type Row = { id: string; roles?: string[]; enabled?: boolean; name?: string; title?: string; userId?: string; courseId?: string; lessonId?: string; email?: string; seats?: number; rank?: number };

const engines: StoreEngine[] = [];
let tmp = "";
const original = { info: console.info, warn: console.warn };
const freshDatabase = () => createTestSchema();

function normalize(data: RawData): Database {
  const db = {} as Record<string, unknown>;
  for (const name of COLLECTIONS) db[name] = Array.isArray(data.collections[name]) ? data.collections[name] : [];
  db.settings = data.settings ?? { siteName: "Test" };
  return db as unknown as Database;
}

function sample(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", name: "Ada", email: "ada@example.com", roles: ["admin"], enabled: true },
        { id: "u2", name: "Grace", email: "grace@example.com" },
        { id: "u3", name: "Linus", email: "linus@example.com" },
      ],
      courses: [{ id: "c1", title: "Intro", seats: 0 }],
      progress: [{ id: "p1", userId: "u1", courseId: "c1", lessonId: "l1" }],
      enrollments: [],
    },
    settings: { siteName: "Loop" },
  };
}

function driverFor(url: string, extra: Partial<ConstructorParameters<typeof PostgresDriver>[0]> = {}): PostgresDriver {
  return new PostgresDriver({ url, collections: COLLECTIONS, backupsDir: path.join(tmp, "backups"), ...extra });
}

function engineFor(url: string, options: { initial?: RawData; externalCheckMs?: number; driver?: PostgresDriver } = {}): StoreEngine {
  const engine = new StoreEngine({
    driver: options.driver ?? driverFor(url),
    collections: COLLECTIONS,
    normalize,
    initialData: async () => options.initial ?? sample(),
    flushDelayMs: 2,
    externalCheckMs: options.externalCheckMs ?? 1_000_000,
  });
  engines.push(engine);
  return engine;
}

/** What PostgreSQL holds, read the way the driver reads it. */
async function stored(url: string): Promise<RawData> {
  const client = await sharedPrismaClient(url);
  return client.$transaction((tx) => readAllData(tx, COLLECTIONS), { isolationLevel: "RepeatableRead" });
}

const ids = (docs: readonly unknown[]) => (docs as Row[]).map((d) => d.id);
const rows = (db: Database, name: (typeof COLLECTIONS)[number]) => db[name] as unknown as Row[];

describe("postgres integration", { skip: PG_SKIP }, () => {
  before(async () => {
    console.info = () => undefined;
    console.warn = () => undefined;
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ll-pg-"));
  });

  after(async () => {
    for (const engine of engines.splice(0)) await engine.close();
    await dropTestSchemas();
    fs.rmSync(tmp, { recursive: true, force: true });
    Object.assign(console, original);
  });

  it("seeds an empty database and round-trips inserts, updates, in-place edits, replacements, removals and order", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url);
    const db = await engine.getDb();
    assert.equal(engine.getStats().origin, "seeded");
    assert.deepEqual(ids((await stored(url)).collections.users!), ["u1", "u2", "u3"]);

    // insert
    await engine.mutate((d) => {
      rows(d, "users").push({ id: "u4", name: "Barbara", email: "barbara@example.com" });
      rows(d, "progress").push({ id: "p2", userId: "u4", courseId: "c1", lessonId: "l2" });
    });
    // update (replaced by a copy) and in-place edit
    await engine.mutate((d) => {
      const list = rows(d, "users");
      const index = list.findIndex((u) => u.id === "u2");
      list[index] = { ...list[index]!, name: "Grace H.", email: "grace@navy.example" };
      list.find((u) => u.id === "u1")!.name = "Ada L.";
    });
    // array replacement (filter) and removal (splice)
    await engine.mutate((d) => {
      (d as unknown as Record<string, Row[]>).progress = rows(d, "progress").filter((p) => p.id !== "p1");
      const list = rows(d, "users");
      list.splice(
        list.findIndex((u) => u.id === "u3"),
        1,
      );
    });
    // order
    await engine.mutate((d) => {
      rows(d, "users").sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    });
    // settings
    await engine.mutate((d) => {
      (d as unknown as { settings: Record<string, unknown> }).settings = { ...d.settings, siteName: "Loop 2" };
    });
    await engine.flush();

    const data = await stored(url);
    assert.deepEqual(data.collections.users, JSON.parse(JSON.stringify(rows(db, "users"))));
    assert.deepEqual(ids(data.collections.users!), ["u1", "u4", "u2"]);
    assert.deepEqual(ids(data.collections.progress!), ["p2"]);
    assert.equal((data.settings as { siteName: string }).siteName, "Loop 2");

    // New documents go after the existing ones even after a renumbering.
    await engine.mutate((d) => {
      rows(d, "users").push({ id: "u5", name: "Alan" });
    });
    await engine.flush();
    assert.deepEqual(ids((await stored(url)).collections.users!), ["u1", "u4", "u2", "u5"]);

    // The extracted columns follow the documents.
    const client = await sharedPrismaClient(url);
    const emails = (await client.$queryRawUnsafe(`SELECT "id", "email" FROM "users" ORDER BY "id"`)) as { id: string; email: string | null }[];
    assert.deepEqual(emails, [
      { id: "u1", email: "ada@example.com" },
      { id: "u2", email: "grace@navy.example" },
      { id: "u4", email: "barbara@example.com" },
      { id: "u5", email: null },
    ]);
    const progress = (await client.$queryRawUnsafe(`SELECT "user_id", "course_id", "lesson_id" FROM "progress"`)) as Record<string, string>[];
    assert.deepEqual(progress, [{ user_id: "u4", course_id: "c1", lesson_id: "l2" }]);

    // A second process opening the database sees exactly the same contents.
    const reopened = engineFor(url);
    assert.deepEqual(JSON.parse(JSON.stringify(await reopened.getDb())), JSON.parse(JSON.stringify(db)));
    assert.equal(reopened.getStats().origin, "existing");
  });

  it("stores text PostgreSQL cannot hold (NUL) as U+FFFD instead of failing", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url);
    await engine.getDb();
    await engine.mutate((d) => {
      rows(d, "users").push({ id: "nul", name: "a\u0000b" });
    });
    assert.equal(await engine.writePending(), true);
    const doc = (await stored(url)).collections.users!.find((u) => (u as Row).id === "nul") as Row;
    assert.equal(doc.name, "a�b");
  });

  it("serializes concurrent mutations", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url);
    await engine.getDb();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        engine.mutate(async (d) => {
          const course = rows(d, "courses")[0]!;
          const seats = course.seats ?? 0;
          await new Promise((resolve) => setImmediate(resolve));
          course.seats = seats + 1;
          rows(d, "enrollments").push({ id: `e${i}`, userId: "u1", courseId: "c1" });
        }),
      ),
    );
    await engine.flush();
    const data = await stored(url);
    assert.equal((data.collections.courses![0] as Row).seats, 40);
    assert.equal(data.collections.enrollments!.length, 40);
  });

  it("reloads after another process wrote, keeping its own unsaved edits", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url, { externalCheckMs: 0 });
    await engine.getDb();
    const other = engineFor(url);
    await other.getDb();
    await other.mutate((d) => {
      rows(d, "courses").push({ id: "c2", title: "Written elsewhere" });
    });
    await other.flush();

    const seen = await engine.mutate((d) => {
      rows(d, "users").push({ id: "mine", name: "Mine" });
      return ids(rows(d, "courses"));
    });
    assert.deepEqual(seen, ["c1", "c2"]);
    assert.equal(engine.getStats().externalReloads, 1);
    await engine.flush();
    const data = await stored(url);
    assert.ok(ids(data.collections.users!).includes("mine"));
    assert.ok(ids(data.collections.courses!).includes("c2"));
  });

  it("fills an empty database from initialData only: old SQLite/JSON files are never imported on open", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url, { initial: { collections: { users: [{ id: "seed-admin", roles: ["admin"], enabled: true }] }, settings: null } });
    const db = await engine.getDb();
    assert.equal(engine.getStats().origin, "seeded");
    assert.deepEqual(ids(rows(db, "users")), ["seed-admin"]);
    const meta = (await sharedPrismaClient(url).then((c) => c.$queryRawUnsafe(`SELECT "value" FROM "meta" WHERE "key" = 'initialized_from'`))) as { value: string }[];
    assert.equal(meta[0]!.value, "seed");
  });

  it("copies an old SQLite database the way db:to-postgres does, without touching the file", async () => {
    const url = await freshDatabase();
    const file = path.join(tmp, `lms-${randomBytes(3).toString("hex")}.sqlite`);
    await createLegacySqlite(file, sample());
    const before = fs.readFileSync(file);
    const { data } = await readSourceDatabase(file);
    const client = await sharedPrismaClient(url);
    await replaceDatabase(client as never, data, `copy:${path.basename(file)}`);
    const engine = engineFor(url, { initial: { collections: {}, settings: null } });
    const db = await engine.getDb();
    assert.equal(engine.getStats().origin, "existing");
    assert.deepEqual(ids(rows(db, "users")), ["u1", "u2", "u3"]);
    assert.equal(rows(db, "users")[0]!.name, "Ada");
    assert.deepEqual(rows(db, "progress"), sample().collections.progress);
    assert.deepEqual((db.settings as unknown as { siteName: string }).siteName, "Loop");
    assert.ok(fs.readFileSync(file).equals(before), "the source file is unchanged");
  });

  it("copies everything in one transaction and verifies the counts (what db:to-postgres does)", async () => {
    const url = await freshDatabase();
    const client = await sharedPrismaClient(url);
    const data = sample();
    const expected = expectedCounts(data, COLLECTIONS);
    const counts = await client.$transaction(async (tx) => {
      await bumpWriteSeq(tx);
      await writeAllData(tx, data, COLLECTIONS, { source: "copy:test.json" });
      return countRows(tx, COLLECTIONS);
    });
    assert.deepEqual(countMismatches(expected, counts), []);
    // A failed verification rolls the whole copy back.
    await assert.rejects(
      client.$transaction(async (tx) => {
        await writeAllData(tx, { collections: { users: [{ id: "x" }] }, settings: null }, COLLECTIONS, { source: "copy:bad" });
        throw new Error("counts do not match");
      }),
      /counts do not match/,
    );
    assert.deepEqual(await countRows(client, COLLECTIONS), counts);
  });

  it("backs up as a JSON export, restores it, and checks integrity", async () => {
    const url = await freshDatabase();
    const engine = engineFor(url);
    await engine.getDb();
    const manager = new BackupManager(engine);
    assert.equal(manager.format, "json");
    const backup = await manager.create({ kind: "manual" });
    assert.equal(backup.records, 5);
    await engine.mutate((d) => {
      rows(d, "users").splice(0, 2);
    });
    await engine.flush();
    const result = await manager.restore(backup.name);
    assert.equal(result.records, 5);
    assert.deepEqual(ids((await stored(url)).collections.users!), ["u1", "u2", "u3"]);
    const quick = await manager.checkIntegrity("quick");
    assert.equal(quick.ok, true, quick.messages.join("; "));
    const full = await manager.checkIntegrity("full");
    assert.equal(full.ok, true, full.messages.join("; "));
    const info = engine.driver.info();
    assert.equal(info.driver, "postgres");
  });

  it("refuses to start on a database without the tables", async () => {
    const driver = driverFor(await createTestSchema({ migrate: false }));
    await assert.rejects(
      driver.open(async () => sample()),
      /missing \d+ table\(s\).*npm run db:setup/,
    );
  });
});
