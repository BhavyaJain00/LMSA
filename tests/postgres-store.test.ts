import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sharedPrismaClient } from "@/lib/db/postgres";
import { countRows, readAllData } from "@/lib/db/postgres-core.mjs";
import { PG_SKIP, createTestSchema, dropTestSchemas } from "./helpers/postgres";

/**
 * Postgres phase 1: the app's own store (`src/lib/db/store.ts`) with
 * DB_DRIVER=postgres — the full demo seed goes into every table, the store
 * API reads and writes through it, and PostgreSQL ends up equal to memory.
 * Runs only with TEST_DATABASE_URL (see tests/helpers/postgres.ts).
 */

if (PG_SKIP) console.log(`# ${PG_SKIP}`);

describe("postgres: the app's store on PostgreSQL", { skip: PG_SKIP }, () => {
  let url = "";
  let tmp = "";
  let store: typeof import("@/lib/db/store");
  const original = { info: console.info, warn: console.warn };

  before(async () => {
    console.info = () => undefined;
    console.warn = () => undefined;
    url = await createTestSchema();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ll-pg-store-"));
    // Set before the store and its configuration are loaded. No SQLite or JSON file: a new database is seeded.
    process.env.DB_DRIVER = "postgres";
    process.env.DATABASE_URL = url;
    process.env.SQLITE_PATH = path.join(tmp, "lms.sqlite");
    process.env.DATA_FILE = path.join(tmp, "db.json");
    store = await import("@/lib/db/store");
  });

  after(async () => {
    const engine = await store?.getStoreEngine().catch(() => null);
    await engine?.close();
    await dropTestSchemas();
    fs.rmSync(tmp, { recursive: true, force: true });
    Object.assign(console, original);
  });

  it("seeds the demo site into every table and reads it back identically", async () => {
    const db = await store.getDb();
    assert.equal(store.getStoreStats()?.driver, "postgres");
    assert.equal(store.getStoreStats()?.origin, "seeded");
    assert.ok(db.users.length > 0 && db.courses.length > 0);

    const client = await sharedPrismaClient(url);
    const counts = await countRows(client, store.COLLECTIONS);
    for (const name of store.COLLECTIONS) assert.equal(counts[name], (db[name] as unknown[]).length, name);

    const data = await client.$transaction((tx) => readAllData(tx, store.COLLECTIONS), { isolationLevel: "RepeatableRead", timeout: 120_000 });
    assert.deepEqual(data.collections, JSON.parse(JSON.stringify(Object.fromEntries(store.COLLECTIONS.map((name) => [name, db[name]])))));
  });

  it("writes through the store API and keeps PostgreSQL equal to memory", async () => {
    const user = (await store.all("users"))[0]!;
    await store.update("users", user.id, { name: "Renamed on PostgreSQL" });
    const course = (await store.all("courses"))[0]!;
    await store.mutate((db) => {
      db.courses.find((c) => c.id === course.id)!.title = "Edited in place";
    });
    const before = await store.count("notifications");
    await store.removeWhere("notifications", (n) => n.userId === user.id);
    await store.flush();

    const client = await sharedPrismaClient(url);
    const rows = (await client.$queryRawUnsafe(`SELECT "doc"->>'name' AS "name", "email" FROM "users" WHERE "id" = $1`, user.id)) as { name: string; email: string }[];
    assert.deepEqual(rows, [{ name: "Renamed on PostgreSQL", email: user.email }]);
    const courses = (await client.$queryRawUnsafe(`SELECT "doc"->>'title' AS "title" FROM "courses" WHERE "id" = $1`, course.id)) as { title: string }[];
    assert.equal(courses[0]?.title, "Edited in place");
    const notifications = (await client.$queryRawUnsafe(`SELECT count(*)::int AS "n" FROM "notifications"`)) as { n: number }[];
    assert.equal(notifications[0]?.n, await store.count("notifications"));
    assert.ok((await store.count("notifications")) <= before);
    assert.match(await store.exportDatabase(), /"Renamed on PostgreSQL"/);
  });
});
