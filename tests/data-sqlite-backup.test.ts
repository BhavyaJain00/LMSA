import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Database } from "@/lib/types";
import { StoreEngine } from "@/lib/db/engine";
import { SqliteDriver } from "@/lib/db/sqlite";
import { JsonDriver } from "@/lib/db/json-driver";
import type { RawData } from "@/lib/db/driver";
import { BackupError, BackupManager, cleanOriginalName } from "@/lib/db/backup";
import {
  backupFileName,
  createDatabaseFile,
  describeBackup,
  listBackupFiles,
  openDatabase,
  parseBackupFileName,
  rawDataToJson,
  readAllData,
  readBackupData,
  resolveStorageConfig,
} from "@/lib/db/sqlite-core.mjs";
import {
  BACKUP_RETENTION,
  automaticBackupState,
  automaticBackupsEnabled,
  backupOffline,
  checkRestorable,
  exportJsonOffline,
  getBackupEntry,
  nextLocalMidnight,
  publishBackup,
  removeStaleTempFiles,
  resolveBackupSource,
  restoreOffline,
  retentionFor,
  tempBackupPath,
} from "@/lib/db/backup-core.mjs";

/**
 * data-sqlite items 5 and 7: backups and restore — retention, publishing,
 * restorability checks, the offline operations behind the CLI scripts, and
 * `BackupManager` (create, daily backup, upload, preview, restore with a
 * safety backup and cache swap, export, delete) on a real SQLite engine.
 */

const COLLECTIONS = ["users", "courses", "enrollments"] as const;

let dir: string;
let counter = 0;
const engines: StoreEngine[] = [];
const original = { info: console.info, warn: console.warn };

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-backup-"));
  console.info = () => undefined;
  console.warn = () => undefined;
});

afterEach(() => {
  for (const engine of engines.splice(0)) engine.close();
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

function sqliteEngine(file: string, initial: RawData = sample()): StoreEngine {
  const engine = new StoreEngine({
    driver: new SqliteDriver({ file, collections: COLLECTIONS }),
    collections: COLLECTIONS,
    normalize,
    initialData: async () => initial,
    flushDelayMs: 5,
  });
  engines.push(engine);
  return engine;
}

function jsonEngine(file: string, initial: RawData = sample()): StoreEngine {
  const engine = new StoreEngine({ driver: new JsonDriver(file), collections: COLLECTIONS, normalize, initialData: async () => initial, flushDelayMs: 5 });
  engines.push(engine);
  return engine;
}

function readFile(file: string): RawData {
  const conn = openDatabase(file, { readOnly: true });
  try {
    return readAllData(conn);
  } finally {
    conn.close();
  }
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
    assert.equal(backupFileName("auto", "sqlite", date), "lms-20260930-auto.sqlite");
    assert.equal(backupFileName("manual", "json", date), "lms-20260930-040506-manual.json");
    assert.equal(backupFileName("safety", "sqlite", date, 2), "lms-20260930-040506-safety-2.sqlite");
    const parsed = parseBackupFileName("lms-20260930-040506-upload.sqlite");
    assert.equal(parsed?.kind, "upload");
    assert.equal(parsed?.format, "sqlite");
    assert.equal(parsed?.date.getHours(), 4);
    for (const bad of ["../lms-20260930-auto.sqlite", "lms-20260930-auto.sqlite/x", "lms-20260930-auto.db", "db.json", "lms-2026-auto.sqlite", "lms-20260930-weekly.sqlite"]) {
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
    const fresh = tempBackupPath(backups, "sqlite");
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
    const a = publishBackup(first, backups, "auto", { format: "json", date, counts: { users: 2 } });
    assert.equal(a.created, true);
    assert.equal(a.entry.name, "lms-20260930-auto.json");
    assert.equal(a.entry.manifest?.records, 2);

    const second = tempBackupPath(backups, "json");
    fs.writeFileSync(second, "{}");
    const b = publishBackup(second, backups, "auto", { format: "json", date: new Date(2026, 8, 30, 22), counts: {} });
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
      return publishBackup(tmp, backups, "manual", { format: "json", date, counts: {} }).entry.name;
    });
    assert.deepEqual(names, ["lms-20260930-090000-manual.json", "lms-20260930-090000-manual-1.json", "lms-20260930-090000-manual-2.json"]);
  });

  it("prunes automatic backups beyond the newest 14 and never manual ones", () => {
    const backups = path.join(folder(), "backups");
    for (let day = 1; day <= 15; day++) fakeBackup(backups, `lms-202609${String(day).padStart(2, "0")}-auto.json`, new Date(2026, 8, day, 1));
    fakeBackup(backups, "lms-20260101-000000-manual.json", new Date(2026, 0, 1));
    const tmp = tempBackupPath(backups, "json");
    fs.writeFileSync(tmp, "{}");
    const result = publishBackup(tmp, backups, "auto", { format: "json", date: new Date(2026, 8, 16, 1), counts: {} });
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
    const result = publishBackup(tmp, backups, "safety", { format: "json", date: new Date(2026, 8, 11), counts: {}, protect: ["lms-20260910-000000-safety.json"] });
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

describe("offline backup, restore and export (CLI operations)", () => {
  function sqliteConfig() {
    const root = folder();
    const config = resolveStorageConfig({ SQLITE_PATH: "data/lms.sqlite" }, root);
    return { root, config };
  }

  it("resolves the storage configuration like the app", () => {
    const root = folder();
    const sqlite = resolveStorageConfig({}, root);
    assert.equal(sqlite.driver, "sqlite");
    assert.equal(sqlite.sqlitePath, path.join(root, "storage", "lms.sqlite"));
    assert.equal(sqlite.backupsDir, path.join(root, "storage", "backups"));
    const json = resolveStorageConfig({ DB_DRIVER: "JSON", DATA_FILE: "x/db.json" }, root);
    assert.equal(json.driver, "json");
    assert.equal(json.backupsDir, path.join(root, "x", "backups"));
  });

  it("backs up a SQLite database with VACUUM INTO and a manifest", () => {
    const { config } = sqliteConfig();
    assert.throws(() => backupOffline(config), /no database/);
    createDatabaseFile(config.sqlitePath, sample(), { collections: COLLECTIONS });
    const result = backupOffline(config, { reason: "Before upgrade", createdBy: "test" });
    assert.equal(result.created, true);
    assert.equal(result.records, 4);
    assert.equal(result.entry?.kind, "manual");
    assert.equal(result.entry?.manifest?.reason, "Before upgrade");
    assert.deepEqual(result.entry?.manifest?.counts, { users: 2, courses: 1, enrollments: 1 });
    assert.deepEqual(ids(readFile(result.file).collections.users), ["u1", "u2"]);

    const auto1 = backupOffline(config, { kind: "auto" });
    const auto2 = backupOffline(config, { kind: "auto" });
    assert.equal(auto1.created, true);
    assert.equal(auto2.created, false);
    assert.equal(auto2.file, auto1.file);

    const out = path.join(folder(), "copy.sqlite");
    const copy = backupOffline(config, { out });
    assert.equal(copy.file, out);
    assert.equal(copy.entry, null);
    assert.throws(() => backupOffline(config, { out }), /already exists/);
  });

  it("backs up the JSON driver's file as a JSON backup", () => {
    const root = folder();
    const config = resolveStorageConfig({ DB_DRIVER: "json", DATA_FILE: "db.json" }, root);
    fs.writeFileSync(config.dataFile, rawDataToJson(sample()));
    const result = backupOffline(config);
    assert.equal(result.entry?.format, "json");
    assert.equal(result.records, 4);
    assert.deepEqual(readBackupData(result.file).data.settings, sample().settings);
  });

  it("restores into a healthy database in one transaction after a safety backup", () => {
    const { root, config } = sqliteConfig();
    createDatabaseFile(config.sqlitePath, sample(), { collections: COLLECTIONS });
    const source = path.join(root, "export.json");
    fs.writeFileSync(source, rawDataToJson(sample({ courses: [{ id: "c9", title: "Restored" }], enrollments: [] })));

    const result = restoreOffline(config, source);
    assert.equal(result.mode, "transaction");
    assert.equal(result.records, 3);
    assert.ok(result.safety, "a safety backup is written first");
    assert.deepEqual(ids(readFile(result.safety.file).collections.courses), ["c1"]);
    const live = readFile(config.sqlitePath);
    assert.deepEqual(ids(live.collections.courses), ["c9"]);
    assert.deepEqual(ids(live.collections.enrollments), []);
  });

  it("refuses a backup without administrators unless forced", () => {
    const { root, config } = sqliteConfig();
    createDatabaseFile(config.sqlitePath, sample(), { collections: COLLECTIONS });
    const source = path.join(root, "no-admin.json");
    fs.writeFileSync(source, rawDataToJson(sample({ users: [{ id: "u2", roles: ["student"] }] })));
    assert.throws(() => restoreOffline(config, source), /no enabled administrator/);
    assert.deepEqual(ids(readFile(config.sqlitePath).collections.users), ["u1", "u2"], "nothing changed");
    const forced = restoreOffline(config, source, { force: true, safetyBackup: false });
    assert.equal(forced.safety, null);
    assert.ok(forced.warnings.some((w) => /administrator/.test(w)));
    assert.deepEqual(ids(readFile(config.sqlitePath).collections.users), ["u2"]);
  });

  it("creates the database when it does not exist yet", () => {
    const { root, config } = sqliteConfig();
    const source = path.join(root, "backup.sqlite");
    createDatabaseFile(source, sample(), { collections: COLLECTIONS });
    const result = restoreOffline(config, source);
    assert.equal(result.mode, "created");
    assert.equal(result.safety, null);
    assert.deepEqual(ids(readFile(config.sqlitePath).collections.users), ["u1", "u2"]);
  });

  it("moves a damaged database aside and rebuilds it from the backup", () => {
    const { root, config } = sqliteConfig();
    fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
    fs.writeFileSync(config.sqlitePath, Buffer.alloc(8192, 0x5a));
    const source = path.join(root, "backup.json");
    fs.writeFileSync(source, rawDataToJson(sample()));
    const result = restoreOffline(config, source);
    assert.equal(result.mode, "replaced-damaged");
    assert.equal(result.movedAside.length, 1);
    assert.match(path.basename(result.movedAside[0]!), /^lms\.sqlite\.damaged-/);
    assert.equal(fs.readFileSync(result.movedAside[0]!).length, 8192, "the damaged file is kept as it was");
    assert.deepEqual(ids(readFile(config.sqlitePath).collections.courses), ["c1"]);
  });

  it("restores the JSON driver's file with a safety copy", () => {
    const root = folder();
    const config = resolveStorageConfig({ DB_DRIVER: "json", DATA_FILE: "db.json" }, root);
    fs.writeFileSync(config.dataFile, rawDataToJson(sample()));
    const source = path.join(root, "other.json");
    fs.writeFileSync(source, rawDataToJson(sample({ courses: [] })));
    const result = restoreOffline(config, source);
    assert.equal(result.mode, "json");
    assert.equal(result.safety?.format, "json");
    assert.deepEqual(JSON.parse(fs.readFileSync(config.dataFile, "utf8")).courses, []);
    assert.equal(JSON.parse(fs.readFileSync(result.safety!.file, "utf8")).courses.length, 1);
  });

  it("exports everything as JSON, to a file or into the backups folder", () => {
    const { root, config } = sqliteConfig();
    createDatabaseFile(config.sqlitePath, sample(), { collections: COLLECTIONS });
    const out = path.join(root, "out", "export.json");
    const toFile = exportJsonOffline(config, { out });
    assert.equal(toFile.records, 4);
    assert.deepEqual(JSON.parse(fs.readFileSync(out, "utf8")).settings, sample().settings);
    assert.throws(() => exportJsonOffline(config, { out }), /EEXIST/);
    const listed = exportJsonOffline(config);
    assert.equal(listed.entry?.kind, "manual");
    assert.equal(listed.entry?.manifest?.reason, "JSON export");
  });

  it("finds a backup by 'latest', by name or by path", () => {
    const { root, config } = sqliteConfig();
    assert.throws(() => resolveBackupSource(config.backupsDir, "latest", root), /no backups/);
    fakeBackup(config.backupsDir, "lms-20260901-auto.json", new Date(2026, 8, 1));
    fakeBackup(config.backupsDir, "lms-20260902-120000-manual.json", new Date(2026, 8, 2, 12));
    assert.equal(path.basename(resolveBackupSource(config.backupsDir, "latest", root)), "lms-20260902-120000-manual.json");
    assert.equal(path.basename(resolveBackupSource(config.backupsDir, "lms-20260901-auto.json", root)), "lms-20260901-auto.json");
    fs.writeFileSync(path.join(root, "mine.json"), "{}");
    assert.equal(resolveBackupSource(config.backupsDir, "mine.json", root), path.join(root, "mine.json"));
    assert.throws(() => resolveBackupSource(config.backupsDir, "nope.json", root), /Backup not found/);
  });
});

describe("BackupManager on a running SQLite store", () => {
  it("creates a manual backup of everything written so far", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    await engine.mutate((db) => void (db as unknown as TestDb).courses.push({ id: "c2", title: "Fresh" }));

    const backup = await manager.create({ kind: "manual", reason: "Before import", createdBy: "Ada (ada@example.com)" });
    assert.equal(manager.format, "sqlite");
    assert.equal(backup.kind, "manual");
    assert.equal(backup.records, 5);
    assert.deepEqual(backup.counts, { users: 2, courses: 2, enrollments: 1 });
    assert.equal(backup.reason, "Before import");
    assert.equal(backup.createdBy, "Ada (ada@example.com)");
    assert.deepEqual(ids(readFile(path.join(manager.dir, backup.name)).collections.courses), ["c1", "c2"]);
    assert.deepEqual(manager.list().map((b) => b.name), [backup.name]);
  });

  it("runs the daily backup once per day and not at all when turned off", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const manager = new BackupManager(sqliteEngine(file));
    const today = new Date(2026, 8, 30, 8);

    process.env.DB_AUTO_BACKUP = "off";
    assert.equal(await manager.runAutomatic(today), null);
    assert.equal(manager.list().length, 0);

    delete process.env.DB_AUTO_BACKUP;
    const [first, concurrent] = await Promise.all([manager.runAutomatic(today), manager.runAutomatic(today)]);
    assert.equal(first?.name, "lms-20260930-auto.sqlite");
    assert.equal(concurrent?.name, first?.name, "concurrent calls share one run");
    assert.equal(await manager.runAutomatic(new Date(2026, 8, 30, 23)), null, "today's backup exists");
    assert.ok(automaticBackupState().lastRunAt);
    const next = await manager.runAutomatic(new Date(2026, 9, 1, 0, 5));
    assert.equal(next?.name, "lms-20261001-auto.sqlite");
  });

  it("previews a restore with counts side by side", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    await engine.mutate((db) => void (db as unknown as TestDb).enrollments.splice(0));
    const preview = await manager.preview(backup.name);
    assert.equal(preview.backupCounts.enrollments, 1);
    assert.equal(preview.currentCounts.enrollments, 0);
    assert.equal(preview.backupRecords, 4);
    assert.equal(preview.currentRecords, 3);
    assert.deepEqual(preview.errors, []);
    await assert.rejects(manager.preview("lms-20200101-auto.sqlite"), (err: unknown) => err instanceof BackupError && err.code === "not-found");
  });

  it("restores a backup: safety backup first, storage replaced, cache swapped in place", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
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
    engine.close();
    engines.splice(engines.indexOf(engine), 1);
    assert.deepEqual(ids(readFile(file).collections.courses), ["c1"]);
    const reopened = (await sqliteEngine(file).getDb()) as unknown as TestDb;
    assert.equal(reopened.users.find((u) => u.id === "u1")?.name, "Ada");
  });

  it("keeps writing normally after a restore", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    await manager.restore(backup.name);
    await engine.mutate((db) => void (db as unknown as TestDb).courses.push({ id: "c3", title: "After restore" }));
    await engine.flush();
    assert.deepEqual(ids(readFile(file).collections.courses), ["c1", "c3"]);
  });

  it("refuses to restore a backup that would lock everyone out, changing nothing", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const engine = sqliteEngine(file);
    const manager = new BackupManager(engine);
    const upload = await manager.receiveUpload(streamOf(rawDataToJson(sample({ users: [{ id: "u9", roles: ["student"], enabled: true }] }))), { originalName: "students.json" });
    await assert.rejects(manager.restore(upload.name), (err: unknown) => err instanceof BackupError && err.code === "invalid" && /administrator/.test(err.message));
    assert.deepEqual(ids(((await engine.getDb()) as unknown as TestDb).users), ["u1", "u2"]);
    assert.equal(manager.list().filter((b) => b.kind === "safety").length, 0);
  });

  it("stores uploaded backups after validating them", async () => {
    const file = path.join(folder(), "lms.sqlite");
    const manager = new BackupManager(sqliteEngine(file));

    const json = await manager.receiveUpload(streamOf(rawDataToJson(sample())), { originalName: "C:\\Users\\ada\\Downloads\\site<1>.json", createdBy: "Ada" });
    assert.equal(json.kind, "upload");
    assert.equal(json.format, "json");
    assert.equal(json.records, 4);
    assert.equal(json.originalName, "site 1 .json");

    const sqliteSource = path.join(folder(), "upload.sqlite");
    createDatabaseFile(sqliteSource, sample(), { collections: COLLECTIONS });
    const sqlite = await manager.receiveUpload(streamOf(fs.readFileSync(sqliteSource)), { originalName: "upload.sqlite" });
    assert.equal(sqlite.format, "sqlite");
    assert.ok(sqlite.name.endsWith(".sqlite"));

    await assert.rejects(manager.receiveUpload(streamOf("hello, not a backup")), (err: unknown) => err instanceof BackupError && err.code === "invalid");
    await assert.rejects(manager.receiveUpload(streamOf('{"users":[{"name":"no id"}]}')), (err: unknown) => err instanceof BackupError && err.code === "invalid" && /no id/.test(err.message));
    await assert.rejects(manager.receiveUpload(streamOf("")), (err: unknown) => err instanceof BackupError && /empty/.test(err.message));
    await assert.rejects(manager.receiveUpload(streamOf("x".repeat(2048)), { maxBytes: 1024 }), (err: unknown) => err instanceof BackupError && err.code === "too-large");

    const leftovers = fs.readdirSync(manager.dir).filter((name) => name.startsWith(".tmp-"));
    assert.deepEqual(leftovers, [], "rejected uploads leave no temporary files");
    assert.equal(manager.list().length, 2);
  });

  it("rejects SQLite files that were not made by this app", async () => {
    const manager = new BackupManager(sqliteEngine(path.join(folder(), "lms.sqlite")));
    const foreign = path.join(folder(), "foreign.sqlite");
    const conn = openDatabase(foreign);
    conn.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    conn.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    conn.exec("PRAGMA journal_mode = DELETE");
    conn.close();
    await assert.rejects(manager.receiveUpload(streamOf(fs.readFileSync(foreign))), (err: unknown) => err instanceof BackupError && /not created by this app/.test(err.message));
  });

  it("exports the live data in either format", async () => {
    const manager = new BackupManager(sqliteEngine(path.join(folder(), "lms.sqlite")));
    const json = await manager.exportTo("json");
    assert.deepEqual(ids(JSON.parse(fs.readFileSync(json.file, "utf8")).users), ["u1", "u2"]);
    assert.equal(json.sizeBytes, fs.statSync(json.file).size);
    const sqlite = await manager.exportTo("sqlite");
    assert.deepEqual(ids(readFile(sqlite.file).collections.enrollments), ["e1"]);
    assert.deepEqual(manager.list(), [], "exports are not listed as backups");
  });

  it("deletes backups by name and ignores anything else", async () => {
    const manager = new BackupManager(sqliteEngine(path.join(folder(), "lms.sqlite")));
    const a = await manager.create({ kind: "manual" });
    const b = await manager.create({ kind: "manual" });
    assert.deepEqual(manager.delete([a.name, a.name, "../lms.sqlite", "lms-20200101-auto.sqlite"]), [a.name]);
    assert.deepEqual(manager.list().map((x) => x.name), [b.name]);
    assert.equal(fs.existsSync(path.join(manager.dir, `${a.name}.manifest.json`)), false);
  });

  it("reports integrity and an overview for the admin page", async () => {
    const engine = sqliteEngine(path.join(folder(), "lms.sqlite"));
    const manager = new BackupManager(engine);
    await manager.create({ kind: "auto", date: new Date(2026, 8, 30) });
    const quick = await manager.checkIntegrity("quick");
    assert.equal(quick.ok, true);
    assert.deepEqual(quick.messages, []);
    assert.equal((await manager.checkIntegrity("full")).mode, "full");

    const overview = await manager.overview();
    assert.equal(overview.info.driver, "sqlite");
    assert.equal(overview.records, 4);
    assert.deepEqual(overview.counts, { users: 2, courses: 1, enrollments: 1 });
    assert.equal(overview.backups.length, 1);
    assert.equal(overview.automatic.enabled, true);
    assert.equal(overview.automatic.keep, 14);
    assert.equal(overview.automatic.lastBackupAt, overview.backups[0]!.createdAt);
    assert.equal(overview.backupsDir, manager.dir);
  });
});

describe("BackupManager on the JSON driver", () => {
  it("backs up, exports a SQLite file and restores", async () => {
    const file = path.join(folder(), "db.json");
    const engine = jsonEngine(file);
    const manager = new BackupManager(engine);
    const backup = await manager.create({ kind: "manual" });
    assert.equal(backup.format, "json");
    assert.equal(backup.records, 4);

    const sqlite = await manager.exportTo("sqlite");
    assert.deepEqual(ids(readFile(sqlite.file).collections.users), ["u1", "u2"]);

    await engine.mutate((db) => void (db as unknown as TestDb).courses.splice(0));
    await engine.flush();
    const result = await manager.restore(backup.name);
    assert.equal(result.safety.format, "json");
    assert.deepEqual(ids(((await engine.getDb()) as unknown as TestDb).courses), ["c1"]);
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).courses.length, 1);
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
