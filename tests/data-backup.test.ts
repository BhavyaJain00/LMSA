import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import type { RawData } from "@/lib/db/driver";
import { BackupError, BackupManager, cleanOriginalName } from "@/lib/db/backup";
import { backupFileName, describeBackup, inspectBackupFile, listBackupFiles, parseBackupFileName, rawDataToJson, readBackupData } from "@/lib/db/data-core.mjs";
import {
  BACKUP_RETENTION,
  automaticBackupState,
  automaticBackupsEnabled,
  checkRestorable,
  getBackupEntry,
  nextLocalMidnight,
  publishBackup,
  removeStaleTempFiles,
  resolveBackupSource,
  retentionFor,
  tempBackupPath,
  writeJsonBackup,
} from "@/lib/db/backup-core.mjs";
import { MemoryDatabase, MemoryDriver } from "./helpers/memory-driver";

/**
 * Backups and restore: retention, publishing, restorability checks, and
 * `BackupManager` (create, daily backup, upload, preview, restore with a
 * safety backup and cache swap, export, delete, demo reset) on a running
 * store engine. Backups are JSON exports; the engine runs on the in-memory
 * test driver (asynchronous, like PostgreSQL).
 */

const COLLECTIONS = ["users", "courses", "enrollments"] as const;

let dir: string;
let counter = 0;
const engines: StoreEngine[] = [];
const original = { info: console.info, warn: console.warn };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-backup-"));
  console.info = () => undefined;
  console.warn = () => undefined;
});

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  delete process.env.DB_AUTO_BACKUP;
  delete process.env.DB_BACKUP_KEEP;
  const state = automaticBackupState();
  state.running = null;
  state.lastError = null;
});

after(() => {
  console.info = original.info;
  console.warn = original.warn;
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh folder for one test. */
function folder(): string {
  const target = path.join(dir, `case-${++counter}`);
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function sample(overrides: Partial<Record<(typeof COLLECTIONS)[number], unknown[]>> = {}): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
      ],
      courses: [{ id: "c1", slug: "intro", title: "Intro" }],
      enrollments: [{ id: "e1", userId: "u2", courseId: "c1" }],
      ...overrides,
    },
    settings: { brand: { name: "Backup Academy" } },
  };
}

function normalize(data: RawData): Database {
  const db: Record<string, unknown> = {};
  for (const name of COLLECTIONS) db[name] = data.collections[name] ?? [];
  db.settings = { brand: { name: "Default" }, ...(data.settings as object | null) };
  return db as unknown as Database;
}

type TestDb = { users: { id: string; name: string; roles: string[] }[]; courses: { id: string; title: string }[]; enrollments: { id: string }[] };

/** A running store on its own in-memory database; backups go to `<folder>/backups`. */
function memoryEngine(database: MemoryDatabase = new MemoryDatabase(), initial: RawData = sample()): StoreEngine {
  const engine = new StoreEngine({
    driver: new MemoryDriver({ database, collections: COLLECTIONS, backupsDir: path.join(folder(), "backups") }),
    collections: COLLECTIONS,
    normalize,
    initialData: async () => initial,
    flushDelayMs: 5,
  });
  engines.push(engine);
  return engine;
}

function readFile(file: string): RawData {
  return readBackupData(file).data;
}

const ids = (docs: unknown[] | undefined) => (docs ?? []).map((doc) => (doc as { id: string }).id).sort();

/** A tiny JSON backup published under `name` with a manifest (for retention tests). */
function fakeBackup(backupsDir: string, name: string, createdAt: Date): void {
  fs.mkdirSync(backupsDir, { recursive: true });
  const file = path.join(backupsDir, name);
  fs.writeFileSync(file, rawDataToJson(sample()), "utf8");
  const parsed = parseBackupFileName(name)!;
  describeBackup(file, { kind: parsed.kind, createdAt: createdAt.toISOString(), counts: { users: 2 } });
}

function streamOf(text: string | Uint8Array): ReadableStream<Uint8Array> {
  return new Blob([typeof text === "string" ? text : Buffer.from(text)]).stream();
}

/* ------------------------------------------------------------------ */

describe("backup policy", () => {
  it("keeps 14 automatic backups by default and honours DB_BACKUP_KEEP within bounds", () => {
    assert.equal(retentionFor("auto", {}), 14);
    assert.equal(retentionFor("auto", { DB_BACKUP_KEEP: "30" }), 30);
    assert.equal(retentionFor("auto", { DB_BACKUP_KEEP: "0" }), 14);
    assert.equal(retentionFor("auto", { DB_BACKUP_KEEP: "-3" }), 14);
    assert.equal(retentionFor("auto", { DB_BACKUP_KEEP: "lots" }), 14);
    assert.equal(retentionFor("auto", { DB_BACKUP_KEEP: "99999" }), 14);
    assert.equal(retentionFor("manual", { DB_BACKUP_KEEP: "3" }), null);
    assert.equal(retentionFor("safety", {}), BACKUP_RETENTION.safety);
    assert.equal(retentionFor("upload", { DB_BACKUP_KEEP: "3" }), BACKUP_RETENTION.upload);
  });

  it("turns the daily backup off only for explicit off values", () => {
    assert.equal(automaticBackupsEnabled({}), true);
    assert.equal(automaticBackupsEnabled({ DB_AUTO_BACKUP: "true" }), true);
    for (const value of ["false", "0", "no", "OFF", " off "]) assert.equal(automaticBackupsEnabled({ DB_AUTO_BACKUP: value }), false, value);
  });

  it("schedules the next check at the following local midnight", () => {
    const now = new Date(2026, 8, 30, 17, 45, 12).getTime();
    assert.equal(nextLocalMidnight(now), new Date(2026, 9, 1, 0, 0, 0, 0).getTime());
    const justAfter = new Date(2026, 9, 1, 0, 0, 1).getTime();
    assert.equal(nextLocalMidnight(justAfter), new Date(2026, 9, 2).getTime());
  });

  it("names backups per kind and parses only its own names", () => {
    const date = new Date(2026, 8, 30, 4, 5, 6);
    assert.equal(backupFileName("auto", date), "lms-20260930-auto.json");
    assert.equal(backupFileName("manual", date), "lms-20260930-040506-manual.json");
    assert.equal(backupFileName("safety", date, 2), "lms-20260930-040506-safety-2.json");
    const parsed = parseBackupFileName("lms-20260930-040506-upload.json");
    assert.equal(parsed?.kind, "upload");
    assert.equal(parsed?.format, "json");
    assert.equal(parsed?.date.getHours(), 4);
    // SQLite backups of older versions are not listed (they are copied with npm run db:to-postgres).
    for (const bad of ["../lms-20260930-auto.json", "lms-20260930-auto.json/x", "lms-20260930-auto.sqlite", "db.json", "lms-2026-auto.json", "lms-20260930-weekly.json"]) {
      assert.equal(parseBackupFileName(bad), null, bad);
    }
  });

  it("finds backups only by a valid name inside the folder", () => {
    const backups = path.join(folder(), "backups");
    fakeBackup(backups, "lms-20260930-auto.json", new Date(2026, 8, 30));
    assert.equal(getBackupEntry(backups, "lms-20260930-auto.json")?.kind, "auto");
    assert.equal(getBackupEntry(backups, "lms-20260929-auto.json"), null);
    assert.equal(getBackupEntry(backups, "../backups/lms-20260930-auto.json"), null);
    assert.equal(getBackupEntry(backups, 42), null);
  });
});

describe("temporary files", () => {
  it("creates unlisted temp paths and removes only stale ones", () => {
    const backups = path.join(folder(), "backups");
    const fresh = tempBackupPath(backups, "json");
    const stale = tempBackupPath(backups, "part");
    fs.writeFileSync(fresh, "x");
    fs.writeFileSync(stale, "x");
    fs.writeFileSync(path.join(backups, "notes.txt"), "keep me");
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000);
    fs.utimesSync(stale, old, old);
    fs.utimesSync(path.join(backups, "notes.txt"), old, old);

    assert.deepEqual(listBackupFiles(backups), []);
    assert.deepEqual(removeStaleTempFiles(backups), [path.basename(stale)]);
    assert.ok(fs.existsSync(fresh));
    assert.ok(fs.existsSync(path.join(backups, "notes.txt")));
    assert.deepEqual(removeStaleTempFiles(path.join(backups, "missing")), []);
  });
});

describe("publishBackup", () => {
  it("keeps one automatic backup per day", () => {
    const backups = path.join(folder(), "backups");
    const date = new Date(2026, 8, 30, 3);
    const first = tempBackupPath(backups, "json");
    fs.writeFileSync(first, rawDataToJson(sample()));
    const a = publishBackup(first, backups, "auto", { date, counts: { users: 2 } });
    assert.equal(a.created, true);
    assert.equal(a.entry.name, "lms-20260930-auto.json");
    assert.equal(a.entry.manifest?.records, 2);

    const second = tempBackupPath(backups, "json");
    fs.writeFileSync(second, "{}");
    const b = publishBackup(second, backups, "auto", { date: new Date(2026, 8, 30, 22), counts: {} });
    assert.equal(b.created, false);
    assert.equal(b.entry.name, a.entry.name);
    assert.equal(fs.existsSync(second), false, "the losing temp file is removed");
    assert.equal(listBackupFiles(backups).length, 1);
  });

  it("gives backups made in the same second distinct names", () => {
    const backups = path.join(folder(), "backups");
    const date = new Date(2026, 8, 30, 9, 0, 0);
    const names = [0, 1, 2].map(() => {
      const tmp = tempBackupPath(backups, "json");
      fs.writeFileSync(tmp, "{}");
      return publishBackup(tmp, backups, "manual", { date, counts: {} }).entry.name;
    });
    assert.deepEqual(names, ["lms-20260930-090000-manual.json", "lms-20260930-090000-manual-1.json", "lms-20260930-090000-manual-2.json"]);
  });

  it("prunes automatic backups beyond the newest 14 and never manual ones", () => {
    const backups = path.join(folder(), "backups");
    for (let day = 1; day <= 15; day++) fakeBackup(backups, `lms-202609${String(day).padStart(2, "0")}-auto.json`, new Date(2026, 8, day, 1));
    fakeBackup(backups, "lms-20260101-000000-manual.json", new Date(2026, 0, 1));
    const tmp = tempBackupPath(backups, "json");
    fs.writeFileSync(tmp, "{}");
    const result = publishBackup(tmp, backups, "auto", { date: new Date(2026, 8, 16, 1), counts: {} });
    assert.deepEqual(result.pruned.sort(), ["lms-20260901-auto.json", "lms-20260902-auto.json"]);
    const left = listBackupFiles(backups);
    assert.equal(left.filter((b) => b.kind === "auto").length, 14);
    assert.ok(left.some((b) => b.kind === "manual"));
    assert.equal(fs.existsSync(path.join(backups, "lms-20260901-auto.json.manifest.json")), false, "manifests go with their backup");
  });

  it("does not prune protected backups (and does not count them)", () => {
    const backups = path.join(folder(), "backups");
    for (let i = 0; i <= BACKUP_RETENTION.safety; i++) fakeBackup(backups, `lms-20260910-0000${String(i).padStart(2, "0")}-safety.json`, new Date(2026, 8, 10, 0, 0, i));
    const tmp = tempBackupPath(backups, "json");
    fs.writeFileSync(tmp, "{}");
    const result = publishBackup(tmp, backups, "safety", { date: new Date(2026, 8, 11), counts: {}, protect: ["lms-20260910-000000-safety.json"] });
    assert.deepEqual(result.pruned, ["lms-20260910-000001-safety.json"]);
    assert.ok(getBackupEntry(backups, "lms-20260910-000000-safety.json"));
  });
});

describe("checkRestorable", () => {
  it("accepts a backup with an enabled administrator", () => {
    const check = checkRestorable(sample(), COLLECTIONS);
    assert.deepEqual(check.errors, []);
    assert.deepEqual(check.warnings, []);
  });

  it("refuses backups that would lock everyone out", () => {
    assert.match(checkRestorable(sample({ users: [] })).errors[0]!, /no member accounts/);
    const disabledAdmin = sample({ users: [{ id: "u1", roles: ["admin"], enabled: false }, { id: "u2", roles: ["student"] }] });
    assert.match(checkRestorable(disabledAdmin).errors[0]!, /no enabled administrator/);
  });

  it("warns about missing settings and collections this version does not know", () => {
    const data: RawData = { collections: { users: sample().collections.users!, legacyThings: [{ id: "x" }], emptyOld: [] }, settings: null };
    const check = checkRestorable(data, COLLECTIONS);
    assert.deepEqual(check.errors, []);
    assert.deepEqual(check.unknownCollections, ["legacyThings"]);
    assert.deepEqual(check.missingCollections, ["courses", "enrollments"]);
    assert.equal(check.warnings.length, 3);
    assert.ok(check.warnings.some((w) => /default settings/.test(w)));
  });
});

describe("backup files on the command line", () => {
  it("finds a backup by 'latest', by name or by path", () => {
    const root = folder();
    const backupsDir = path.join(root, "backups");
    assert.throws(() => resolveBackupSource(backupsDir, "latest", root), /no backups/);
    fakeBackup(backupsDir, "lms-20260901-auto.json", new Date(2026, 8, 1));
    fakeBackup(backupsDir, "lms-20260902-120000-manual.json", new Date(2026, 8, 2, 12));
    assert.equal(path.basename(resolveBackupSource(backupsDir, "latest", root)), "lms-20260902-120000-manual.json");
    assert.equal(path.basename(resolveBackupSource(backupsDir, "lms-20260901-auto.json", root)), "lms-20260901-auto.json");
    fs.writeFileSync(path.join(root, "mine.json"), "{}");
    assert.equal(resolveBackupSource(backupsDir, "mine.json", root), path.join(root, "mine.json"));
    assert.throws(() => resolveBackupSource(backupsDir, "nope.json", root), /Backup not found/);
  });

  it("writeJsonBackup() writes an export with its manifest and applies the retention", () => {
    const backupsDir = path.join(folder(), "backups");
    const written = writeJsonBackup(backupsDir, "manual", sample(), { date: new Date(2026, 8, 30, 9), reason: "JSON export", createdBy: "db:export script" });
    assert.equal(written.created, true);
    assert.equal(written.entry.name, "lms-20260930-090000-manual.json");
    assert.equal(written.records, 4);
    assert.deepEqual(readFile(written.entry.file), sample());
    assert.equal(written.entry.manifest?.reason, "JSON export");
    assert.deepEqual(inspectBackupFile(written.entry.file).counts, { users: 2, courses: 1, enrollments: 1 });
    assert.deepEqual(fs.readdirSync(backupsDir).filter((name) => name.startsWith(".tmp-")), [], "no temporary file is left");
    assert.equal(listBackupFiles(backupsDir).length, 1);
  });
});

describe("BackupManager on a running store", () => {
  it("creates a manual backup of everything written so far", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database);
    const manager = new BackupManager(engine);
    await engine.mutate((db) => void (db as unknown as TestDb).courses.push({ id: "c2", title: "Fresh" }));

    const backup = await manager.create({ kind: "manual", reason: "Before import", createdBy: "Ada (ada@example.com)" });
    assert.equal(manager.format, "json");
    assert.equal(backup.kind, "manual");
    assert.equal(backup.records, 5);
    assert.deepEqual(backup.counts, { users: 2, courses: 2, enrollments: 1 });
    assert.equal(backup.reason, "Before import");
    assert.equal(backup.createdBy, "Ada (ada@example.com)");
    assert.deepEqual(ids(readFile(path.join(manager.dir, backup.name)).collections.courses), ["c1", "c2"]);
    assert.deepEqual(manager.list().map((b) => b.name), [backup.name]);
  });

  it("runs the daily backup once per day and not at all when turned off", async () => {
    const manager = new BackupManager(memoryEngine());
    const today = new Date(2026, 8, 30, 8);

    process.env.DB_AUTO_BACKUP = "off";
    assert.equal(await manager.runAutomatic(today), null);
    assert.equal(manager.list().length, 0);

    delete process.env.DB_AUTO_BACKUP;
    const [first, concurrent] = await Promise.all([manager.runAutomatic(today), manager.runAutomatic(today)]);
    assert.equal(first?.name, "lms-20260930-auto.json");
    assert.equal(concurrent?.name, first?.name, "concurrent calls share one run");
    assert.equal(await manager.runAutomatic(new Date(2026, 8, 30, 23)), null, "today's backup exists");
    assert.ok(automaticBackupState().lastRunAt);
    const next = await manager.runAutomatic(new Date(2026, 9, 1, 0, 5));
    assert.equal(next?.name, "lms-20261001-auto.json");
  });

  it("previews a restore with counts side by side", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    await engine.mutate((db) => void (db as unknown as TestDb).enrollments.splice(0));
    const preview = await manager.preview(backup.name);
    assert.equal(preview.backupCounts.enrollments, 1);
    assert.equal(preview.currentCounts.enrollments, 0);
    assert.equal(preview.backupRecords, 4);
    assert.equal(preview.currentRecords, 3);
    assert.deepEqual(preview.errors, []);
    await assert.rejects(manager.preview("lms-20200101-auto.json"), (err: unknown) => err instanceof BackupError && err.code === "not-found");
  });

  it("restores a backup: safety backup first, storage replaced, cache swapped in place", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database);
    const manager = new BackupManager(engine);
    const db = (await engine.getDb()) as unknown as TestDb;
    const backup = await manager.create({ kind: "manual" });

    await engine.mutate((live) => {
      const t = live as unknown as TestDb;
      t.courses.push({ id: "c2", title: "Added after the backup" });
      t.users[0]!.name = "Ada Lovelace";
    });

    const result = await manager.restore(backup.name, { createdBy: "Ada (ada@example.com)" });
    assert.equal(result.records, 4);
    assert.equal(result.restored.name, backup.name);
    assert.equal(result.safety.kind, "safety");
    assert.equal(result.safety.reason, `Before restoring ${backup.name}`);

    // The cache: the same object, now holding the backup's contents.
    assert.equal(await engine.getDb(), db as unknown as Database);
    assert.deepEqual(ids(db.courses), ["c1"]);
    assert.equal(db.users.find((u) => u.id === "u1")?.name, "Ada");

    // The safety backup holds the data from just before.
    const safety = readFile(path.join(manager.dir, result.safety.name));
    assert.deepEqual(ids(safety.collections.courses), ["c1", "c2"]);

    // Storage: the restored data, also after a restart.
    await engine.close();
    engines.splice(engines.indexOf(engine), 1);
    assert.deepEqual(ids(database.read(COLLECTIONS).collections.courses), ["c1"]);
    const reopened = (await memoryEngine(database).getDb()) as unknown as TestDb;
    assert.equal(reopened.users.find((u) => u.id === "u1")?.name, "Ada");
  });

  it("keeps writing normally after a restore", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    await manager.restore(backup.name);
    await engine.mutate((db) => void (db as unknown as TestDb).courses.push({ id: "c3", title: "After restore" }));
    await engine.flush();
    assert.deepEqual(ids(database.read(COLLECTIONS).collections.courses), ["c1", "c3"]);
  });

  it("refuses to restore a backup that would lock everyone out, changing nothing", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database);
    const manager = new BackupManager(engine);
    const upload = await manager.receiveUpload(streamOf(rawDataToJson(sample({ users: [{ id: "u9", roles: ["student"], enabled: true }] }))), { originalName: "students.json" });
    await assert.rejects(manager.restore(upload.name), (err: unknown) => err instanceof BackupError && err.code === "invalid" && /administrator/.test(err.message));
    assert.deepEqual(ids(((await engine.getDb()) as unknown as TestDb).users), ["u1", "u2"]);
    assert.equal(manager.list().filter((b) => b.kind === "safety").length, 0);
  });

  it("stores uploaded backups after validating them", async () => {
    const manager = new BackupManager(memoryEngine());

    const json = await manager.receiveUpload(streamOf(rawDataToJson(sample())), { originalName: "C:\\Users\\ada\\Downloads\\site<1>.json", createdBy: "Ada" });
    assert.equal(json.kind, "upload");
    assert.equal(json.format, "json");
    assert.equal(json.records, 4);
    assert.equal(json.originalName, "site 1 .json");

    await assert.rejects(manager.receiveUpload(streamOf("hello, not a backup")), (err: unknown) => err instanceof BackupError && err.code === "invalid");
    await assert.rejects(manager.receiveUpload(streamOf('{"users":[{"name":"no id"}]}')), (err: unknown) => err instanceof BackupError && err.code === "invalid" && /no id/.test(err.message));
    await assert.rejects(manager.receiveUpload(streamOf("")), (err: unknown) => err instanceof BackupError && /empty/.test(err.message));
    await assert.rejects(manager.receiveUpload(streamOf("x".repeat(2048)), { maxBytes: 1024 }), (err: unknown) => err instanceof BackupError && err.code === "too-large");

    const leftovers = fs.readdirSync(manager.dir).filter((name) => name.startsWith(".tmp-"));
    assert.deepEqual(leftovers, [], "rejected uploads leave no temporary files");
    assert.equal(manager.list().length, 1);
  });

  it("rejects SQLite files and points to the copy script", async () => {
    const manager = new BackupManager(memoryEngine());
    const sqliteHeader = Buffer.concat([Buffer.from("SQLite format 3\u0000", "latin1"), Buffer.alloc(100)]);
    await assert.rejects(manager.receiveUpload(streamOf(sqliteHeader), { originalName: "lms.sqlite" }), (err: unknown) => err instanceof BackupError && err.code === "invalid" && /db:to-postgres/.test(err.message));
    assert.deepEqual(manager.list(), []);
  });

  it("exports the live data as JSON", async () => {
    const manager = new BackupManager(memoryEngine());
    const json = await manager.exportTo();
    assert.deepEqual(ids(JSON.parse(fs.readFileSync(json.file, "utf8")).users), ["u1", "u2"]);
    assert.deepEqual(ids(readFile(json.file).collections.enrollments), ["e1"]);
    assert.equal(json.sizeBytes, fs.statSync(json.file).size);
    assert.deepEqual(manager.list(), [], "exports are not listed as backups");
  });

  it("deletes backups by name and ignores anything else", async () => {
    const manager = new BackupManager(memoryEngine());
    const a = await manager.create({ kind: "manual" });
    const b = await manager.create({ kind: "manual" });
    assert.deepEqual(manager.delete([a.name, a.name, "../lms.json", "lms-20200101-auto.json"]), [a.name]);
    assert.deepEqual(manager.list().map((x) => x.name), [b.name]);
    assert.equal(fs.existsSync(path.join(manager.dir, `${a.name}.manifest.json`)), false);
  });

  it("reports integrity and an overview for the admin page", async () => {
    const engine = memoryEngine();
    const manager = new BackupManager(engine);
    await manager.create({ kind: "auto", date: new Date(2026, 8, 30) });
    const quick = await manager.checkIntegrity("quick");
    assert.equal(quick.ok, true);
    assert.deepEqual(quick.messages, []);
    assert.equal((await manager.checkIntegrity("full")).mode, "full");

    const overview = await manager.overview();
    assert.equal(overview.info.driver, "memory");
    assert.equal(overview.records, 4);
    assert.deepEqual(overview.counts, { users: 2, courses: 1, enrollments: 1 });
    assert.equal(overview.backups.length, 1);
    assert.equal(overview.automatic.enabled, true);
    assert.equal(overview.automatic.keep, 14);
    assert.equal(overview.automatic.lastBackupAt, overview.backups[0]!.createdAt);
    assert.equal(overview.backupsDir, manager.dir);
  });
});

/* ------------------------------------------------------------------ */
/* Settling and the demo reset                                         */
/* ------------------------------------------------------------------ */

function fixSample(): RawData {
  const data = sample();
  return { ...data, collections: { users: data.collections.users!, courses: [{ id: "c1", title: "Intro" }], enrollments: [] } };
}

function demo(): RawData {
  return {
    collections: { users: [{ id: "demo-admin", email: "admin@example.com", name: "Demo", roles: ["admin"], enabled: true }], courses: [{ id: "demo-course", title: "Demo" }] },
    settings: { brand: { name: "Demo Academy" } },
  };
}

type Row = { id: string; title?: string; name?: string };
const idsInOrder = (rows: readonly unknown[] | undefined) => ((rows ?? []) as Row[]).map((r) => r.id);

describe("backups settle the storage in slices", () => {
  it("create() and exportTo() do not use the one-pass flush(), and still capture unreported edits", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database, fixSample());
    const manager = new BackupManager(engine);
    const db = (await engine.getDb()) as unknown as { courses: Row[] };
    engine.flush = async () => {
      throw new Error("flush() must not be used for snapshots");
    };
    db.courses[0]!.title = "Edited outside mutate()";
    const backup = await manager.create({ kind: "manual" });
    assert.equal((readFile(path.join(manager.dir, backup.name)).collections.courses as Row[])[0]!.title, "Edited outside mutate()");
    const exported = await manager.exportTo();
    assert.deepEqual(idsInOrder(readFile(exported.file).collections.courses), ["c1"]);
    fs.rmSync(exported.file, { force: true });
  });

  it("restore() (exclusive) does not use the one-pass flush(), and its safety backup holds unreported edits", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database, fixSample());
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
    const database = new MemoryDatabase();
    const engine = memoryEngine(database, fixSample());
    const manager = new BackupManager(engine);
    await engine.getDb();
    const replaced = manager.replaceWith(demo(), { source: "demo-reset", reason: "Before reloading the demo data", createdBy: "Ada" });
    // Saved while the reset is under way: it must end up in the safety backup or in the live data, never in neither.
    const during = engine.mutate((db) => void (db as unknown as { courses: Row[] }).courses.push({ id: "c-during", title: "Saved during the reset" }));
    const safety = await replaced;
    await during;
    assert.equal(safety.kind, "safety");
    assert.equal(safety.reason, "Before reloading the demo data");
    const saved = idsInOrder(readFile(path.join(manager.dir, safety.name)).collections.courses);
    const live = idsInOrder(((await engine.getDb()) as unknown as { courses: Row[] }).courses);
    assert.ok(saved.includes("c-during") || live.includes("c-during"), `kept somewhere (backup: ${saved}, live: ${live})`);
    assert.ok(saved.includes("c1"), "the safety backup holds the previous data");
    assert.ok(live.includes("demo-course"), "the demo data is live");
    assert.ok(!live.includes("c1"));
    // Storage matches the cache.
    await engine.flush();
    assert.deepEqual(idsInOrder(database.read(COLLECTIONS).collections.courses), live);
  });

  it("changes nothing when the safety backup cannot be written", async () => {
    const database = new MemoryDatabase();
    const engine = memoryEngine(database, fixSample());
    const manager = new BackupManager(engine);
    await engine.getDb();
    // A file where the backups folder should be: the snapshot cannot be written.
    fs.writeFileSync(manager.dir, "not a folder");
    await assert.rejects(manager.replaceWith(demo(), { source: "demo-reset", reason: "Before reloading the demo data" }));
    assert.deepEqual(idsInOrder(((await engine.getDb()) as unknown as { courses: Row[] }).courses), ["c1"]);
  });
});

describe("cleanOriginalName", () => {
  it("keeps a bounded plain file name", () => {
    assert.equal(cleanOriginalName("/tmp/a/b/backup.sqlite"), "backup.sqlite");
    assert.equal(cleanOriginalName("..\\..\\evil\u0000name.json"), "evil name.json");
    assert.equal(cleanOriginalName(".."), undefined);
    assert.equal(cleanOriginalName(""), undefined);
    assert.equal(cleanOriginalName(null), undefined);
    assert.equal(cleanOriginalName(`${"x".repeat(300)}.json`)?.length, 120);
  });
});
