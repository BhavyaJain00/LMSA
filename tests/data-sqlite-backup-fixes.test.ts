import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import type { RawData } from "@/lib/db/driver";
import { BackupManager } from "@/lib/db/backup";
import { createDatabaseFile, deleteBackupFile, inspectBackupFile, openDatabase, readAllData, readBackupData, resolveStorageConfig } from "@/lib/db/sqlite-core.mjs";
import { backupOffline, moveFile } from "@/lib/db/backup-core.mjs";

/**
 * Review fixes (data-sqlite, round 3) for backups:
 *  - snapshots settle the storage in short slices instead of one flush pass;
 *  - the demo reset takes its safety backup and replaces the data in one
 *    exclusive step, so nothing saved in between is lost;
 *  - `db:backup --out` works across drives and filesystems (EXDEV);
 *  - reading a WAL-mode backup leaves no -wal/-shm files, and deleting a
 *    backup removes any that exist.
 */

const COLLECTIONS = ["users", "courses"] as const;

let dir: string;
let counter = 0;
const engines: StoreEngine[] = [];
const quiet = { info: console.info, warn: console.warn };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-backup-fixes-"));
  console.info = () => undefined;
  console.warn = () => undefined;
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close();
});

after(() => {
  console.info = quiet.info;
  console.warn = quiet.warn;
  fs.rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const target = path.join(dir, `case-${++counter}`);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sample(): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
      ],
      courses: [{ id: "c1", title: "Intro" }],
    },
    settings: { brand: { name: "Backup Academy" } },
  };
}

function demo(): RawData {
  return {
    collections: { users: [{ id: "demo-admin", email: "admin@example.com", name: "Demo", roles: ["admin"], enabled: true }], courses: [{ id: "demo-course", title: "Demo" }] },
    settings: { brand: { name: "Demo Academy" } },
  };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = data.settings ?? {};
  return db as unknown as Database;
}

function sqliteEngine(file: string): StoreEngine {
  const engine = new StoreEngine({ driver: new SqliteDriver({ file, collections: COLLECTIONS }), collections: COLLECTIONS, normalize, initialData: async () => sample(), flushDelayMs: 5 });
  engines.push(engine);
  return engine;
}

type Row = { id: string; title?: string; name?: string };
const ids = (rows: readonly unknown[]) => (rows as Row[]).map((r) => r.id);

function readFile(file: string): RawData {
  return readBackupData(file).data;
}

/** A SQLite database in WAL mode, as a raw copy of the live `lms.sqlite` would be. */
function walModeCopy(target: string): void {
  const source = path.join(folder(), "live.sqlite");
  createDatabaseFile(source, sample(), { collections: COLLECTIONS });
  const conn = openDatabase(source);
  conn.exec("PRAGMA journal_mode = WAL");
  conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  conn.close();
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(source + suffix, { force: true });
  fs.copyFileSync(source, target);
  const header = fs.readFileSync(target).subarray(18, 20);
  assert.deepEqual([...header], [2, 2], "the copy is a WAL-mode database");
}

describe("backups settle the storage in slices", () => {
  it("create() and exportTo() do not use the one-pass flush(), and still capture unreported edits", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    const db = (await engine.getDb()) as unknown as { courses: Row[] };
    engine.flush = async () => {
      throw new Error("flush() must not be used for snapshots");
    };
    db.courses[0]!.title = "Edited outside mutate()";
    const backup = await manager.create({ kind: "manual" });
    assert.equal((readFile(path.join(manager.dir, backup.name)).collections.courses as Row[])[0]!.title, "Edited outside mutate()");
    const exported = await manager.exportTo("sqlite");
    assert.deepEqual(ids(readFile(exported.file).collections.courses), ["c1"]);
    fs.rmSync(exported.file, { force: true });
  });

  it("restore() (exclusive) does not use the one-pass flush(), and its safety backup holds unreported edits", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    const db = (await engine.getDb()) as unknown as { courses: Row[] };
    const backup = await manager.create({ kind: "manual" });
    engine.flush = async () => {
      throw new Error("flush() must not be used for restores");
    };
    db.courses[0]!.title = "Edited outside mutate() before the restore";
    const result = await manager.restore(backup.name);
    const safety = readFile(path.join(manager.dir, result.safety.name)).collections.courses as Row[];
    assert.equal(safety[0]!.title, "Edited outside mutate() before the restore");
    assert.equal(((await engine.getDb()) as unknown as { courses: Row[] }).courses[0]!.title, "Intro");
  });
});

describe("replaceWith() (demo data reset)", () => {
  it("takes the safety backup and replaces the data in one exclusive step", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    await engine.getDb();
    const replaced = manager.replaceWith(demo(), { source: "demo-reset", reason: "Before reloading the demo data", createdBy: "Ada" });
    // Saved while the reset is under way: it must end up in the safety backup or in the live data, never in neither.
    const during = engine.mutate((db) => void (db as unknown as { courses: Row[] }).courses.push({ id: "c-during", title: "Saved during the reset" }));
    const safety = await replaced;
    await during;
    assert.equal(safety.kind, "safety");
    assert.equal(safety.reason, "Before reloading the demo data");
    const saved = ids(readFile(path.join(manager.dir, safety.name)).collections.courses);
    const live = ids(((await engine.getDb()) as unknown as { courses: Row[] }).courses);
    assert.ok(saved.includes("c-during") || live.includes("c-during"), `kept somewhere (backup: ${saved}, live: ${live})`);
    assert.ok(saved.includes("c1"), "the safety backup holds the previous data");
    assert.ok(live.includes("demo-course"), "the demo data is live");
    assert.ok(!live.includes("c1"));
    // Storage matches the cache.
    await engine.flush();
    const conn = openDatabase(file, { readOnly: true });
    try {
      assert.deepEqual(ids(readAllData(conn, COLLECTIONS).collections.courses), live);
    } finally {
      conn.close();
    }
  });

  it("changes nothing when the safety backup cannot be written", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    await engine.getDb();
    // A file where the backups folder should be: the snapshot cannot be written.
    fs.writeFileSync(manager.dir, "not a folder");
    await assert.rejects(manager.replaceWith(demo(), { source: "demo-reset", reason: "Before reloading the demo data" }));
    assert.deepEqual(ids(((await engine.getDb()) as unknown as { courses: Row[] }).courses), ["c1"]);
  });
});

describe("db:backup --out on another filesystem", () => {
  function exdev(target: string) {
    const rename = fs.renameSync;
    fs.renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
      if (path.resolve(String(to)) === path.resolve(target)) throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
      return rename(from, to);
    }) as typeof fs.renameSync;
    return () => {
      fs.renameSync = rename;
    };
  }

  it("moveFile() copies and removes the source when rename cannot cross devices", () => {
    const base = folder();
    const from = path.join(base, "a.bin");
    const to = path.join(folder(), "b.bin");
    fs.writeFileSync(from, "snapshot");
    const restore = exdev(to);
    try {
      moveFile(from, to);
    } finally {
      restore();
    }
    assert.equal(fs.readFileSync(to, "utf8"), "snapshot");
    assert.equal(fs.existsSync(from), false);

    // Never overwrites: the copy refuses an existing target and the source stays.
    fs.writeFileSync(from, "second");
    const again = exdev(to);
    try {
      assert.throws(() => moveFile(from, to), /EEXIST/);
    } finally {
      again();
    }
    assert.equal(fs.readFileSync(to, "utf8"), "snapshot");
    assert.equal(fs.existsSync(from), true);
  });

  it("backupOffline({ out }) writes the snapshot across devices and leaves no temporary file", () => {
    const root = folder();
    const config = resolveStorageConfig({ SQLITE_PATH: "data/lms.sqlite" }, root);
    createDatabaseFile(config.sqlitePath, sample(), { collections: COLLECTIONS });
    const out = path.join(folder(), "offsite", "copy.sqlite");
    const restore = exdev(out);
    let result: ReturnType<typeof backupOffline>;
    try {
      result = backupOffline(config, { out });
    } finally {
      restore();
    }
    assert.equal(result.file, out);
    assert.equal(result.records, 3);
    assert.deepEqual(ids(readFile(out).collections.users), ["u1", "u2"]);
    const leftovers = fs.existsSync(config.backupsDir) ? fs.readdirSync(config.backupsDir).filter((name) => name.startsWith(".tmp-")) : [];
    assert.deepEqual(leftovers, []);
  });
});

describe("WAL-mode backup files", () => {
  it("reading one leaves no -wal or -shm file behind", () => {
    const file = path.join(folder(), "copy.sqlite");
    walModeCopy(file);
    inspectBackupFile(file);
    readBackupData(file);
    assert.equal(fs.existsSync(`${file}-wal`), false);
    assert.equal(fs.existsSync(`${file}-shm`), false);
  });

  it("does not remove sidecar files that existed before (a database in use)", () => {
    const file = path.join(folder(), "copy.sqlite");
    walModeCopy(file);
    const writer = openDatabase(file);
    try {
      assert.ok(fs.existsSync(`${file}-shm`));
      readBackupData(file);
      assert.ok(fs.existsSync(`${file}-shm`), "the writer's shared-memory file is left alone");
    } finally {
      writer.close();
    }
  });

  it("an uploaded WAL-mode copy can be previewed and restored without leaving files, and deleting a backup removes its sidecars", async () => {
    const engine = sqliteEngine(path.join(folder(), "lms.sqlite"));
    const manager = new BackupManager(engine);
    const source = path.join(folder(), "raw-copy.sqlite");
    walModeCopy(source);
    const body = new Blob([fs.readFileSync(source)]).stream();
    const upload = await manager.receiveUpload(body, { originalName: "raw-copy.sqlite" });
    await manager.preview(upload.name);
    const restored = await manager.restore(upload.name);
    const stray = fs.readdirSync(manager.dir).filter((name) => /-(wal|shm|journal)$/.test(name));
    assert.deepEqual(stray, [], "no sidecar files in the backups folder");

    // Sidecars left by an earlier version are removed with their backup.
    const file = path.join(manager.dir, restored.safety.name);
    for (const suffix of ["-wal", "-shm", "-journal"]) fs.writeFileSync(file + suffix, "");
    deleteBackupFile(file);
    for (const suffix of ["", "-wal", "-shm", "-journal"]) assert.equal(fs.existsSync(file + suffix), false, `removed ${suffix || "the backup"}`);
  });
});
