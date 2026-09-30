import { after, afterEach, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import type { RawData } from "@/lib/db/driver";
import { countRows, isInitialized, listCollectionTables, openDatabase, rawDataToJson, readAllData, readMeta } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite item 4: the one-time JSON → SQLite import. On the first start
 * with the SQLite driver an existing db.json is imported in one transaction
 * and renamed to `db.json.migrated-<timestamp>` (never deleted); when there
 * is neither a SQLite database nor a JSON file the database is seeded.
 */

const COLLECTIONS = ["users", "courses", "enrollments"] as const;
const ARCHIVE = /^db\.json\.migrated-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?$/;

let dir: string;
const drivers: SqliteDriver[] = [];
const logs = { info: [] as string[], warn: [] as string[] };
const original = { info: console.info, warn: console.warn };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-migration-"));
  console.info = (...args: unknown[]) => void logs.info.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void logs.warn.push(args.map(String).join(" "));
});

afterEach(() => {
  for (const driver of drivers.splice(0)) driver.close();
  logs.info.length = 0;
  logs.warn.length = 0;
});

after(() => {
  console.info = original.info;
  console.warn = original.warn;
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
/** A fresh storage folder with the paths the app would use in it. */
function storage(): { folder: string; sqlite: string; json: string } {
  counter++;
  const folder = path.join(dir, `case-${counter}`);
  fs.mkdirSync(folder, { recursive: true });
  return { folder, sqlite: path.join(folder, "lms.sqlite"), json: path.join(folder, "db.json") };
}

function legacy(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"] },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"] },
      ],
      courses: [{ id: "c1", slug: "intro", title: "Intro — “quotes”, emoji 🎓 and\nnew lines", chapters: [{ id: "ch1", lessons: ["l1", "l2"] }] }],
      enrollments: [
        { id: "e1", userId: "u1", courseId: "c1", progress: 40 },
        { id: "e2", userId: "u2", courseId: "c1", progress: 0 },
      ],
    },
    settings: { brand: { name: "Imported Academy" }, learning: { videoCompletionThreshold: 75 } },
  };
}

function open(paths: { sqlite: string; json?: string }, extra: { collections?: readonly string[]; snapshot?: () => RawData | null } = {}): SqliteDriver {
  const driver = new SqliteDriver({ file: paths.sqlite, collections: extra.collections ?? COLLECTIONS, legacyJsonFile: paths.json, legacySnapshot: extra.snapshot });
  drivers.push(driver);
  return driver;
}

const neverSeed = async (): Promise<RawData> => {
  throw new Error("the database must not be seeded here");
};

const archives = (folder: string) => fs.readdirSync(folder).filter((name) => name.startsWith("db.json.migrated-"));

function inspect<T>(file: string, fn: (conn: ReturnType<typeof openDatabase>) => T): T {
  const conn = openDatabase(file, { readOnly: true });
  try {
    return fn(conn);
  } finally {
    conn.close();
  }
}

describe("JSON → SQLite import", () => {
  it("imports every collection and the settings, then renames the JSON file without changing it", async () => {
    const paths = storage();
    const text = rawDataToJson(legacy());
    fs.writeFileSync(paths.json, text, "utf8");

    const driver = open(paths);
    const opened = await driver.open(neverSeed);
    assert.equal(opened.origin, "imported-json");
    assert.deepEqual(opened.data, legacy());

    assert.equal(fs.existsSync(paths.json), false, "db.json is no longer in the way");
    const kept = archives(paths.folder);
    assert.equal(kept.length, 1);
    assert.match(kept[0]!, ARCHIVE);
    assert.equal(fs.readFileSync(path.join(paths.folder, kept[0]!), "utf8"), text, "the archived file is the original, byte for byte");

    const meta = driver.info().meta;
    assert.equal(meta.initialized_from, "json:db.json");
    assert.equal(meta.legacy_json_archive, kept[0]);
    assert.ok(Date.parse(meta.initialized_at!) > 0);
    assert.deepEqual(
      inspect(paths.sqlite, (conn) => countRows(conn)),
      { users: 2, courses: 1, enrollments: 2 },
    );
    assert.ok(logs.info.some((line) => /imported 5 document\(s\) from db\.json/.test(line)));
    assert.ok(logs.info.some((line) => line.includes(kept[0]!)));
    assert.deepEqual(logs.warn, []);
  });

  it("does not import, seed or rename anything on the following starts", async () => {
    const paths = storage();
    fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
    await open(paths).open(neverSeed);
    drivers.splice(0).forEach((d) => d.close());
    const kept = archives(paths.folder);

    const again = await open(paths).open(neverSeed);
    assert.equal(again.origin, "existing");
    assert.deepEqual(again.data, legacy());
    assert.deepEqual(archives(paths.folder), kept);
    assert.deepEqual(logs.warn, []);
  });

  it("keeps collections this version of the app does not know in their own tables", async () => {
    const paths = storage();
    const data = legacy();
    data.collections.retiredThings = [{ id: "r1", note: "from an older version" }];
    fs.writeFileSync(paths.json, JSON.stringify({ ...data.collections, settings: data.settings, schemaNote: "not a collection", version: 3 }), "utf8");

    const opened = await open(paths).open(neverSeed);
    assert.deepEqual(Object.keys(opened.data.collections), [...COLLECTIONS], "the app only loads its own collections");
    inspect(paths.sqlite, (conn) => {
      assert.ok(listCollectionTables(conn).includes("retiredThings"));
      assert.deepEqual(readAllData(conn, ["retiredThings"]).collections.retiredThings, [{ id: "r1", note: "from an older version" }]);
    });
  });

  it("imports an empty JSON database as an empty database instead of seeding", async () => {
    const paths = storage();
    fs.writeFileSync(paths.json, "{}\n", "utf8");
    const opened = await open(paths).open(neverSeed);
    assert.equal(opened.origin, "imported-json");
    assert.deepEqual(opened.data, { collections: { users: [], courses: [], enrollments: [] }, settings: null });
    assert.equal(archives(paths.folder).length, 1);
  });

  it("accepts a file with a byte-order mark and pretty-printed or compact JSON", async () => {
    for (const pretty of [true, false]) {
      const paths = storage();
      fs.writeFileSync(paths.json, `﻿${rawDataToJson(legacy(), pretty)}`, "utf8");
      assert.deepEqual((await open(paths).open(neverSeed)).data, legacy());
    }
  });

  it("refuses a file it cannot read completely and leaves everything as it was", async () => {
    const broken: [string, RegExp][] = [
      ["{ not json", /Could not import .*db\.json into SQLite: The JSON file could not be read/],
      [JSON.stringify({ users: [{ id: "u1" }, { email: "no-id@example.com" }] }), /Could not import .*Collection "users", item 2 has no id.*DB_DRIVER=json/],
      ["[1, 2, 3]", /does not contain a database/],
    ];
    for (const [text, message] of broken) {
      const paths = storage();
      fs.writeFileSync(paths.json, text, "utf8");
      await assert.rejects(open(paths).open(neverSeed), message);
      assert.equal(fs.readFileSync(paths.json, "utf8"), text, "the JSON file is untouched");
      assert.deepEqual(archives(paths.folder), []);
      drivers.splice(0).forEach((d) => d.close());
      assert.equal(
        inspect(paths.sqlite, (conn) => isInitialized(conn)),
        false,
        "the SQLite file stays empty, so the import runs again once the file is fixed",
      );

      fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
      assert.equal((await open(paths).open(neverSeed)).origin, "imported-json");
    }
  });

  it("imports in one transaction: a failure part-way leaves no rows behind", async () => {
    const paths = storage();
    fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
    // Contents handed over in memory are not pre-validated, so this fails while writing the last collection.
    const damaged = legacy();
    (damaged.collections.enrollments as unknown[]).push({ userId: "u9" });
    await assert.rejects(open(paths, { snapshot: () => damaged }).open(neverSeed), /Collection "enrollments", item 3 has no id/);
    drivers.splice(0).forEach((d) => d.close());
    inspect(paths.sqlite, (conn) => {
      assert.equal(isInitialized(conn), false);
      assert.deepEqual(countRows(conn), { users: 0, courses: 0, enrollments: 0 });
    });
    assert.equal(fs.existsSync(paths.json), true, "db.json is only renamed after a successful import");
    assert.deepEqual(archives(paths.folder), []);
  });

  it("keeps the first of two documents with the same id and says which collection lost one", async () => {
    const paths = storage();
    const data = legacy();
    (data.collections.users as unknown[]).push({ id: "u1", email: "copy@example.com", name: "Second copy" });
    fs.writeFileSync(paths.json, rawDataToJson(data), "utf8");
    const opened = await open(paths).open(neverSeed);
    assert.deepEqual(opened.data.collections.users, legacy().collections.users);
    assert.equal(logs.warn.length, 1);
    assert.match(logs.warn[0]!, /users \(1\)/);
    assert.match(fs.readFileSync(path.join(paths.folder, archives(paths.folder)[0]!), "utf8"), /Second copy/, "the skipped copy is still in the archived JSON");
  });

  it("never overwrites an earlier archive", async () => {
    const paths = storage();
    const now = new Date("2026-03-04T05:06:07.089Z");
    const taken = `${paths.json}.migrated-2026-03-04T05-06-07-089Z`;
    fs.writeFileSync(taken, "an earlier archive", "utf8");
    fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
    mock.timers.enable({ apis: ["Date"], now });
    try {
      await open(paths).open(neverSeed);
    } finally {
      mock.timers.reset();
    }
    assert.equal(fs.readFileSync(taken, "utf8"), "an earlier archive");
    assert.deepEqual(archives(paths.folder).sort(), ["db.json.migrated-2026-03-04T05-06-07-089Z", "db.json.migrated-2026-03-04T05-06-07-089Z-2"]);
    assert.equal(fs.readFileSync(`${taken}-2`, "utf8"), rawDataToJson(legacy()));
  });

  it("ignores a JSON file next to a database that already has data, and says so", async () => {
    const paths = storage();
    await open({ sqlite: paths.sqlite }).open(async () => legacy());
    drivers.splice(0).forEach((d) => d.close());

    const stray = JSON.stringify({ users: [{ id: "other", email: "other@example.com" }] });
    fs.writeFileSync(paths.json, stray, "utf8");
    const opened = await open(paths).open(neverSeed);
    assert.equal(opened.origin, "existing");
    assert.deepEqual(opened.data, legacy());
    assert.equal(fs.readFileSync(paths.json, "utf8"), stray, "the file is neither imported nor renamed");
    assert.deepEqual(archives(paths.folder), []);
    assert.equal(logs.warn.length, 1);
    assert.match(logs.warn[0]!, /db\.json exists but is not used[\s\S]*db:restore/);
  });

  it("prefers the contents of a JSON store that was running in this process over its file", async () => {
    const paths = storage();
    fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
    const live = legacy();
    (live.collections.users as { name: string }[])[0]!.name = "Ada, edited but not yet written";
    const driver = open(paths, { snapshot: () => live });
    const opened = await driver.open(neverSeed);
    assert.equal(opened.origin, "imported-json");
    assert.equal((opened.data.collections.users as { name: string }[])[0]!.name, "Ada, edited but not yet written");
    assert.equal(driver.info().meta.initialized_from, "json:memory");
    assert.equal(archives(paths.folder).length, 1, "the file it came from is still archived");
  });
});

describe("first start without a JSON database", () => {
  it("seeds the database once and creates no JSON file", async () => {
    const paths = storage();
    let calls = 0;
    const seed = async () => {
      calls++;
      return legacy();
    };
    const driver = open(paths);
    const opened = await driver.open(seed);
    assert.equal(opened.origin, "seeded");
    assert.deepEqual(opened.data, legacy());
    assert.equal(driver.info().meta.initialized_from, "seed");
    assert.deepEqual(
      fs.readdirSync(paths.folder).filter((name) => !name.startsWith("lms.sqlite")),
      [],
      "nothing but the SQLite files",
    );
    drivers.splice(0).forEach((d) => d.close());

    const again = await open(paths).open(seed);
    assert.equal(again.origin, "existing");
    assert.equal(calls, 1);
  });

  it("does not leave a half-created database behind when seeding fails", async () => {
    const paths = storage();
    await assert.rejects(
      open(paths).open(async () => {
        throw new Error("SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD");
      }),
      /requires ADMIN_EMAIL/,
    );
    drivers.splice(0).forEach((d) => d.close());
    const opened = await open(paths).open(async () => legacy());
    assert.equal(opened.origin, "seeded", "the next start seeds normally");
  });
});

describe("the engine after an import", () => {
  function normalize(data: RawData): Database {
    const db: Record<string, unknown> = {};
    for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
    db.settings = { brand: { name: "Default" }, features: { courses: true }, ...(data.settings as object | null) };
    return db as unknown as Database;
  }

  it("reports where the data came from and stores later changes in SQLite only", async () => {
    const paths = storage();
    fs.writeFileSync(paths.json, rawDataToJson(legacy()), "utf8");
    const origins: string[] = [];
    const engine = new StoreEngine({
      driver: open(paths),
      collections: COLLECTIONS,
      normalize,
      initialData: neverSeed,
      onOpen: (origin) => void origins.push(origin),
    });
    try {
      const db = (await engine.getDb()) as unknown as { users: { id: string; name: string }[]; settings: Record<string, unknown> };
      assert.deepEqual(origins, ["imported-json"]);
      assert.equal(engine.getStats().origin, "imported-json");
      assert.deepEqual(db.users.map((u) => u.id), ["u1", "u2"]);
      assert.deepEqual(db.settings.features, { courses: true }, "settings missing from the old file get their defaults");

      await engine.mutate((d) => {
        const users = (d as unknown as typeof db).users;
        users.find((u) => u.id === "u2")!.name = "Bob, after the import";
        users.push({ id: "u3", name: "Joined later" });
      });
      await engine.flush();
      inspect(paths.sqlite, (conn) => {
        const users = readAllData(conn, ["users"]).collections.users as { id: string; name: string }[];
        assert.deepEqual(users.map((u) => u.name), ["Ada", "Bob, after the import", "Joined later"]);
        assert.equal(readMeta(conn).initialized_from, "json:db.json");
      });
      assert.equal(fs.existsSync(paths.json), false, "no JSON file is written any more");
      assert.match(fs.readFileSync(path.join(paths.folder, archives(paths.folder)[0]!), "utf8"), /"Bob"/, "the archive keeps the pre-import state");
    } finally {
      engine.close();
    }
  });
});
