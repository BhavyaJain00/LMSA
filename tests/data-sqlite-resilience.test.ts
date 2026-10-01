import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import { DatabaseCorruptedError, DatabaseLockedError, SqliteDriver } from "@/lib/db/sqlite";
import type { RawData } from "@/lib/db/driver";
import { BackupError, BackupManager } from "@/lib/db/backup";
import { createDatabaseFile, isBusyError, isCorruptionError, openDatabase, readAllData, vacuumInto, type SqliteConnection } from "@/lib/db/sqlite-core.mjs";
import { probeDatabase } from "@/lib/db/backup-core.mjs";

/**
 * data-sqlite item 6: a damaged database stops the start with restore
 * instructions (startup `PRAGMA quick_check`), and a write lock held by
 * another process (SQLITE_BUSY) is reported clearly and retried without
 * losing changes.
 */

const COLLECTIONS = ["users", "courses", "enrollments"] as const;

let dir: string;
let counter = 0;
const engines: StoreEngine[] = [];
const connections: SqliteConnection[] = [];
const original = { info: console.info, warn: console.warn, error: console.error };
const errors: string[] = [];

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-resilience-"));
  console.info = () => undefined;
  console.warn = () => undefined;
  console.error = (...args: unknown[]) => void errors.push(args.map(String).join(" "));
});

afterEach(() => {
  for (const conn of connections.splice(0)) {
    try {
      if (conn.isTransaction) conn.exec("ROLLBACK");
      conn.close();
    } catch {
      // Already closed by the test.
    }
  }
  for (const engine of engines.splice(0)) engine.close();
  errors.length = 0;
});

after(() => {
  console.info = original.info;
  console.warn = original.warn;
  console.error = original.error;
  fs.rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const target = path.join(dir, `case-${++counter}`);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sample(courses = 1): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
      ],
      courses: Array.from({ length: courses }, (_, i) => ({ id: `c${i + 1}`, slug: `course-${i + 1}`, title: `Course ${i + 1}`, body: "lorem ipsum ".repeat(40) })),
      enrollments: [],
    },
    settings: { brand: { name: "Resilient Academy" } },
  };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = { ...(data.settings as object | null) };
  return db as unknown as Database;
}

function engineFor(file: string, busyTimeoutMs?: number): StoreEngine {
  const engine = new StoreEngine({
    driver: new SqliteDriver({ file, collections: COLLECTIONS, busyTimeoutMs }),
    collections: COLLECTIONS,
    normalize,
    initialData: async () => sample(),
    flushDelayMs: 5,
  });
  engines.push(engine);
  return engine;
}

/** Another process's connection that holds the write lock until released. */
function holdWriteLock(file: string): { release: () => void } {
  const conn = openDatabase(file);
  connections.push(conn);
  conn.exec("BEGIN IMMEDIATE");
  return { release: () => conn.exec("COMMIT") };
}

function read(file: string): RawData {
  const conn = openDatabase(file, { readOnly: true });
  try {
    return readAllData(conn);
  } finally {
    conn.close();
  }
}

/** Overwrite every page after the first (the schema stays readable, the tables do not). */
function damage(file: string): void {
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r+");
  try {
    fs.writeSync(fd, Buffer.alloc(size - 4096, 0xa5), 0, size - 4096, 4096);
  } finally {
    fs.closeSync(fd);
  }
}

type TestDb = { users: { id: string; name: string }[]; courses: { id: string; title: string }[] };

describe("SQLite error classification", () => {
  it("recognizes lock errors", () => {
    assert.equal(isBusyError(Object.assign(new Error("x"), { errcode: 5 })), true);
    assert.equal(isBusyError(Object.assign(new Error("x"), { errcode: 6 })), true);
    assert.equal(isBusyError(new Error("database is locked")), true);
    assert.equal(isBusyError(new Error("database table is locked: users")), true);
    assert.equal(isBusyError(new Error("disk I/O error")), false);
    assert.equal(isBusyError(null), false);
    assert.equal(isBusyError("database is locked"), false);
  });

  it("recognizes damaged files", () => {
    assert.equal(isCorruptionError(Object.assign(new Error("x"), { errcode: 11 })), true);
    assert.equal(isCorruptionError(Object.assign(new Error("x"), { errcode: 26 })), true);
    assert.equal(isCorruptionError(new Error("database disk image is malformed")), true);
    assert.equal(isCorruptionError(new Error("file is not a database")), true);
    assert.equal(isCorruptionError(new Error("database is locked")), false);
    assert.equal(isCorruptionError(undefined), false);
  });
});

describe("start-up integrity check", () => {
  it("opens a healthy database", async () => {
    const file = path.join(folder(), "lms.sqlite");
    createDatabaseFile(file, sample(), { collections: COLLECTIONS });
    const db = (await engineFor(file).getDb()) as unknown as TestDb;
    assert.equal(db.users.length, 2);
    assert.equal(probeDatabase(file).state, "healthy");
    assert.equal(probeDatabase(path.join(folder(), "missing.sqlite")).state, "missing");
  });

  it("stops with restore instructions naming the newest backup when the file is damaged", async () => {
    const root = folder();
    const file = path.join(root, "lms.sqlite");
    createDatabaseFile(file, sample(60), { collections: COLLECTIONS });
    const backup = path.join(root, "backups", "lms-20260930-auto.sqlite");
    const conn = openDatabase(file);
    vacuumInto(conn, backup);
    conn.close();
    damage(file);

    assert.equal(probeDatabase(file).state, "damaged");
    await assert.rejects(engineFor(file).getDb(), (err: unknown) => {
      assert.ok(err instanceof DatabaseCorruptedError, String(err));
      assert.match(err.message, /failed its integrity check/);
      assert.ok(err.message.includes(`npm run db:restore -- "${backup}"`), err.message);
      assert.match(err.message, /damaged-<timestamp>/);
      return true;
    });
  });

  it("explains a file that is not a database at all", async () => {
    const root = folder();
    const file = path.join(root, "lms.sqlite");
    fs.writeFileSync(file, Buffer.alloc(16384, 0x42));
    await assert.rejects(engineFor(file).getDb(), (err: unknown) => {
      assert.ok(err instanceof DatabaseCorruptedError, String(err));
      assert.ok(err.message.includes(`<file from ${path.join(root, "backups")}>`), err.message);
      return true;
    });
    assert.equal(fs.readFileSync(file).length, 16384, "the damaged file is left untouched");
  });
});

describe("SQLITE_BUSY: another process holds the write lock", () => {
  it("keeps changes in memory while locked and writes them once the lock is released", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = engineFor(file, 50);
    await engine.getDb();
    const lock = holdWriteLock(file);

    await engine.mutate((db) => {
      (db as unknown as TestDb).users[0]!.name = "Written later";
    });
    await engine.flush();
    const stats = engine.getStats();
    assert.equal(stats.pending, true);
    assert.match(stats.lastError?.message ?? "", /locked by another process/);
    assert.ok(errors.some((line) => /locked/.test(line)), "the failure is logged");
    assert.equal((read(file).collections.users as TestDb["users"])[0]!.name, "Ada");

    lock.release();
    await engine.flush();
    assert.equal(engine.getStats().pending, false);
    assert.equal((read(file).collections.users as TestDb["users"])[0]!.name, "Written later");
  });

  it("reports a lock during a full replacement with the single-process advice", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = engineFor(file, 50);
    await engine.getDb();
    const lock = holdWriteLock(file);
    try {
      assert.throws(
        () => engine.driver.replaceAll(sample(3), "test"),
        (err: unknown) => err instanceof DatabaseLockedError && /Only one app process/.test(err.message),
      );
    } finally {
      lock.release();
    }
  });

  it("turns a lock during restore into a 'busy' error and leaves the data as it was", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = engineFor(file, 50);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    await engine.mutate((db) => void (db as unknown as TestDb).courses.push({ id: "c2", title: "Kept" }));
    await engine.flush();

    const lock = holdWriteLock(file);
    try {
      await assert.rejects(manager.restore(backup.name), (err: unknown) => err instanceof BackupError && err.code === "busy" && /locked by another process/.test(err.message));
    } finally {
      lock.release();
    }
    const db = (await engine.getDb()) as unknown as TestDb;
    assert.deepEqual(
      db.courses.map((c) => c.id),
      ["c1", "c2"],
    );
    assert.deepEqual(
      (read(file).collections.courses as TestDb["courses"]).map((c) => c.id),
      ["c1", "c2"],
    );

    // Once the lock is gone the same restore works.
    await manager.restore(backup.name);
    assert.deepEqual(
      ((await engine.getDb()) as unknown as TestDb).courses.map((c) => c.id),
      ["c1"],
    );
  });
});
