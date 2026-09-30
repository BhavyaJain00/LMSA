import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { JsonDriver } from "@/lib/db/json-driver";
import { SqliteDriver } from "@/lib/db/sqlite";
import type { RawData, StoreDriver } from "@/lib/db/driver";
import { listCollectionTables, openDatabase, readMeta } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite item 1: both storage drivers behind the one StoreDriver
 * interface (open/seed, persist, replace, reload, backup copy, info).
 */

let dir: string;
const drivers: StoreDriver[] = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-drivers-"));
});

after(() => {
  for (const driver of drivers) driver.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function caseDir(): string {
  counter++;
  const out = path.join(dir, `case-${counter}`);
  fs.mkdirSync(out, { recursive: true });
  return out;
}

const COLLECTIONS = ["users", "courses", "enrollments"] as const;

function sample(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada" },
        { id: "u2", email: "bob@example.com", name: "Bob" },
      ],
      courses: [{ id: "c1", slug: "intro", title: "Intro" }],
      enrollments: [{ id: "e1", userId: "u1", courseId: "c1" }],
    },
    settings: { siteName: "Test site", updatedAt: "2026-01-01T00:00:00.000Z" },
  };
}

function sqliteDriver(file: string, collections: readonly string[] = COLLECTIONS, legacyJsonFile?: string): SqliteDriver {
  const driver = new SqliteDriver({ file, collections, legacyJsonFile });
  drivers.push(driver);
  return driver;
}

function jsonDriver(file: string): JsonDriver {
  const driver = new JsonDriver(file);
  drivers.push(driver);
  return driver;
}

const seedOnce = () => {
  let calls = 0;
  return {
    initial: async () => {
      calls++;
      return sample();
    },
    calls: () => calls,
  };
};

describe("SqliteDriver", () => {
  it("seeds an empty file once and reads it back on the next start", async () => {
    const file = path.join(caseDir(), "lms.sqlite");
    const seed = seedOnce();
    const first = sqliteDriver(file);
    const opened = await first.open(seed.initial);
    assert.equal(opened.origin, "seeded");
    assert.deepEqual(opened.data, sample());
    assert.equal(first.kind, "sqlite");
    assert.equal(first.incremental, true);
    first.close();

    const second = sqliteDriver(file);
    const reopened = await second.open(seed.initial);
    assert.equal(reopened.origin, "existing");
    assert.deepEqual(reopened.data, sample());
    assert.equal(seed.calls(), 1);

    const meta = second.info().meta;
    assert.equal(meta.initialized_from, "seed");
    assert.ok(meta.initialized_at);
  });

  it("applies change sets (upserts, deletes, settings) in insertion order", async () => {
    const file = path.join(caseDir(), "lms.sqlite");
    const driver = sqliteDriver(file);
    await driver.open(async () => sample());
    const data = sample();
    driver.persist(data, {
      collections: [
        {
          name: "users",
          upserts: [
            { id: "u1", json: JSON.stringify({ id: "u1", email: "ada@example.com", name: "Ada L." }) },
            { id: "u3", json: JSON.stringify({ id: "u3", email: "cy@example.com", name: "Cy" }) },
          ],
          deletes: ["u2"],
        },
        { name: "enrollments", upserts: [], deletes: ["e1"] },
      ],
      settings: JSON.stringify({ siteName: "Renamed" }),
    });
    const reloaded = driver.reload();
    assert.deepEqual(reloaded.collections.users, [
      { id: "u1", email: "ada@example.com", name: "Ada L." },
      { id: "u3", email: "cy@example.com", name: "Cy" },
    ]);
    assert.deepEqual(reloaded.collections.enrollments, []);
    assert.deepEqual(reloaded.collections.courses, sample().collections.courses);
    assert.deepEqual(reloaded.settings, { siteName: "Renamed" });
    // The JSON driver's calling convention (no change set) writes nothing here.
    driver.persist(sample(), null);
    assert.deepEqual(driver.reload().settings, { siteName: "Renamed" });
  });

  it("replaces everything atomically, emptying collections missing from the new data", async () => {
    const file = path.join(caseDir(), "lms.sqlite");
    const driver = sqliteDriver(file);
    await driver.open(async () => sample());
    driver.replaceAll({ collections: { users: [{ id: "u9", email: "new@example.com" }] }, settings: { siteName: "Fresh" } }, "test");
    const data = driver.reload();
    assert.deepEqual(data.collections.users, [{ id: "u9", email: "new@example.com" }]);
    assert.deepEqual(data.collections.courses, []);
    assert.deepEqual(data.collections.enrollments, []);
    assert.deepEqual(data.settings, { siteName: "Fresh" });
    assert.equal(driver.info().meta.last_replaced_from, "test");

    assert.throws(() => driver.replaceAll({ collections: { users: [{ email: "no id" }] }, settings: null }, "bad"), /has no id/);
    assert.deepEqual(driver.reload().collections.users, [{ id: "u9", email: "new@example.com" }], "a failed replace changes nothing");
  });

  it("creates tables for collections added while running and after a restart", async () => {
    const file = path.join(caseDir(), "lms.sqlite");
    const driver = sqliteDriver(file);
    await driver.open(async () => sample());
    driver.addCollections(["users", "badges"]);
    driver.persist(sample(), { collections: [{ name: "badges", upserts: [{ id: "b1", json: '{"id":"b1"}' }], deletes: [] }], settings: null });
    assert.deepEqual(driver.reload().collections.badges, [{ id: "b1" }]);
    driver.close();

    const later = sqliteDriver(file, [...COLLECTIONS, "badges", "leads"]);
    const { data } = await later.open(async () => sample());
    assert.deepEqual(data.collections.badges, [{ id: "b1" }]);
    assert.deepEqual(data.collections.leads, []);
    const conn = openDatabase(file, { readOnly: true });
    try {
      assert.ok(listCollectionTables(conn).includes("leads"));
    } finally {
      conn.close();
    }
  });

  it("notices writes made by another connection", async () => {
    const file = path.join(caseDir(), "lms.sqlite");
    const mine = sqliteDriver(file);
    await mine.open(async () => sample());
    assert.equal(mine.hasExternalChanges(), false);
    mine.persist(sample(), { collections: [{ name: "courses", upserts: [{ id: "c2", json: '{"id":"c2","slug":"two"}' }], deletes: [] }], settings: null });
    assert.equal(mine.hasExternalChanges(), false, "own writes are not external");

    const other = sqliteDriver(file);
    await other.open(async () => sample());
    other.persist(sample(), { collections: [{ name: "users", upserts: [], deletes: ["u2"] }], settings: null });
    assert.equal(mine.hasExternalChanges(), true);
    assert.equal(mine.hasExternalChanges(), false, "reported once");
    assert.deepEqual(
      mine.reload().collections.users.map((u) => (u as { id: string }).id),
      ["u1"],
    );
  });

  it("describes the storage and copies it with VACUUM INTO", async () => {
    const folder = caseDir();
    const file = path.join(folder, "lms.sqlite");
    const driver = sqliteDriver(file);
    await driver.open(async () => sample());
    const info = driver.info();
    assert.equal(info.driver, "sqlite");
    assert.equal(info.file, file);
    assert.ok((info.sizeBytes ?? 0) > 0);
    assert.equal(typeof info.schemaVersion, "number");
    assert.match(info.sqliteVersion ?? "", /^3\.\d+/);
    assert.equal(driver.backupsDir, path.join(folder, "backups"));
    assert.deepEqual(driver.checkIntegrity("quick"), { ok: true, messages: ["ok"] });

    const copy = path.join(driver.backupsDir, "copy.sqlite");
    driver.backupTo(copy);
    const conn = openDatabase(copy, { readOnly: true });
    try {
      assert.equal(Number(conn.prepare(`SELECT count(*) AS n FROM "users"`).get()?.n), 2);
      assert.equal(readMeta(conn).schema_version, driver.info().meta.schema_version);
    } finally {
      conn.close();
    }
    assert.throws(() => driver.backupTo(copy), "an existing target is never overwritten");
  });
});

describe("JsonDriver", () => {
  it("seeds a missing file, then reads the existing one", async () => {
    const file = path.join(caseDir(), "nested", "db.json");
    const seed = seedOnce();
    const driver = jsonDriver(file);
    assert.equal(driver.kind, "json");
    assert.equal(driver.incremental, false);
    const opened = await driver.open(seed.initial);
    assert.equal(opened.origin, "seeded");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { ...sample().collections, settings: sample().settings });

    const again = await jsonDriver(file).open(seed.initial);
    assert.equal(again.origin, "existing");
    assert.deepEqual(again.data, sample());
    assert.equal(seed.calls(), 1);
  });

  it("rewrites the whole file on persist and replaceAll without leaving temp files", async () => {
    const folder = caseDir();
    const file = path.join(folder, "db.json");
    const driver = jsonDriver(file);
    await driver.open(async () => sample());
    const data = sample();
    (data.collections.users as { id: string; name?: string }[])[0]!.name = "Changed";
    await driver.persist(data);
    assert.equal(driver.reload().collections.users[0] && (driver.reload().collections.users[0] as { name: string }).name, "Changed");
    await driver.replaceAll({ collections: { users: [] }, settings: null });
    assert.deepEqual(driver.reload(), { collections: { users: [] }, settings: null });
    assert.deepEqual(fs.readdirSync(folder), ["db.json"]);
    assert.equal(driver.hasExternalChanges(), false);
  });

  it("explains how to recover from a damaged file", async () => {
    const file = path.join(caseDir(), "db.json");
    fs.writeFileSync(file, "{ not json", "utf8");
    const driver = jsonDriver(file);
    await assert.rejects(driver.open(async () => sample()), /not valid JSON[\s\S]*db:restore/);
    assert.equal(driver.checkIntegrity().ok, false);
  });

  it("accepts a UTF-8 byte-order mark and writes JSON backups next to the file", async () => {
    const folder = caseDir();
    const file = path.join(folder, "db.json");
    fs.writeFileSync(file, `﻿${JSON.stringify({ users: [{ id: "u1" }] })}`, "utf8");
    const driver = jsonDriver(file);
    const { data } = await driver.open(async () => sample());
    assert.deepEqual(data.collections.users, [{ id: "u1" }]);
    const target = path.join(driver.backupsDir, "copy.json");
    await driver.backupTo(target, data);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { users: [{ id: "u1" }] });
    await assert.rejects(Promise.resolve().then(() => driver.backupTo(target, data)), /EEXIST/);
    assert.equal(driver.info().driver, "json");
    assert.ok((driver.info().sizeBytes ?? 0) > 0);
  });
});
