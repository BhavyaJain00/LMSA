import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RawData } from "@/lib/db/driver";
import { sharedPrismaClient } from "@/lib/db/postgres";
import { knownCollections, readAllData } from "@/lib/db/postgres-core.mjs";
import { listBackupFiles, rawDataToJson, readBackupData } from "@/lib/db/data-core.mjs";
import { replaceDatabase } from "../scripts/lib/pg.mjs";
import { PG_SKIP, createTestSchema, dropTestSchemas } from "./helpers/postgres";
import { createLegacySqlite } from "./helpers/legacy-sqlite";

/**
 * The database scripts (`npm run db:backup`, `db:restore`, `db:export`,
 * `db:to-postgres`) as real child processes against PostgreSQL. Runs only
 * when TEST_DATABASE_URL is set (see tests/helpers/postgres.ts); every case
 * gets its own temporary schema and storage folder, passed explicitly so the
 * project's `.env` is never used.
 */

if (PG_SKIP) console.log(`# ${PG_SKIP}`);

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = {
  backup: "scripts/db-backup.mjs",
  restore: "scripts/db-restore.mjs",
  export: "scripts/db-export-json.mjs",
  copy: "scripts/db-copy-to-postgres.mjs",
} as const;

let dir = "";
let counter = 0;

function sample(courses: string[] = ["c1"]): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
      ],
      courses: courses.map((id) => ({ id, slug: id, title: `Course ${id}` })),
    },
    settings: { brand: { name: "Script Academy" } },
  };
}

interface Case {
  url: string;
  root: string;
  backups: string;
  run(script: keyof typeof SCRIPTS, args: string[]): { code: number | null; stdout: string; stderr: string };
  read(): Promise<RawData>;
}

async function setup(options: { data?: RawData } = {}): Promise<Case> {
  const url = await createTestSchema();
  const root = path.join(dir, `case-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  if (options.data) await replaceDatabase((await sharedPrismaClient(url)) as never, options.data, "fixture");
  return {
    url,
    root,
    backups: path.join(root, "storage", "backups"),
    run(script, args) {
      const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, STORAGE_DIR: path.join(root, "storage"), INIT_CWD: root };
      delete env.NODE_OPTIONS;
      delete env.DEBUG;
      const result = spawnSync(process.execPath, [path.join(ROOT, SCRIPTS[script]), ...args], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },
    async read() {
      const client = await sharedPrismaClient(url);
      return client.$transaction((tx) => readAllData(tx, knownCollections()), { timeout: 120_000 });
    },
  };
}

const courseIds = (data: RawData) => (data.collections.courses ?? []).map((c) => (c as { id: string }).id);

describe("postgres: database scripts", { skip: PG_SKIP, concurrency: false }, () => {
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-pg-scripts-"));
  });

  after(async () => {
    await dropTestSchemas();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("db:backup writes a JSON export with a manifest; --auto makes one per day", async () => {
    const c = await setup({ data: sample() });
    const manual = c.run("backup", ["--note", "Before the upgrade"]);
    assert.equal(manual.code, 0, manual.stderr);
    assert.match(manual.stdout, /Backup written: .*lms-\d{8}-\d{6}-manual\.json/);
    const auto = c.run("backup", ["--auto"]);
    assert.equal(auto.code, 0, auto.stderr);
    const again = c.run("backup", ["--auto"]);
    assert.match(again.stdout, /already exists/);
    const list = listBackupFiles(c.backups);
    assert.deepEqual(list.map((b) => b.kind).sort(), ["auto", "manual"]);
    const manualEntry = list.find((b) => b.kind === "manual")!;
    assert.equal(manualEntry.manifest?.reason, "Before the upgrade");
    assert.equal(manualEntry.manifest?.counts.users, 2);
    assert.deepEqual(courseIds(readBackupData(manualEntry.file).data), ["c1"]);
  });

  it("db:export writes to a file or standard output", async () => {
    const c = await setup({ data: sample(["c1", "c2"]) });
    const out = c.run("export", ["--out", "export.json", "--counts"]);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(courseIds(readBackupData(path.join(c.root, "export.json")).data), ["c1", "c2"]);
    const stdout = c.run("export", ["--stdout", "--compact"]);
    assert.equal(stdout.code, 0, stdout.stderr);
    assert.deepEqual(JSON.parse(stdout.stdout).courses.map((x: { id: string }) => x.id), ["c1", "c2"]);
  });

  it("db:restore fills an empty database, and replaces one with data only with --force (after a safety backup)", async () => {
    const empty = await setup();
    const file = path.join(empty.root, "export.json");
    fs.writeFileSync(file, rawDataToJson(sample(["c1", "c2", "c3"])));
    const filled = empty.run("restore", ["export.json"]);
    assert.equal(filled.code, 0, filled.stderr);
    assert.deepEqual(courseIds(await empty.read()), ["c1", "c2", "c3"]);

    const c = await setup({ data: sample(["live"]) });
    fs.writeFileSync(path.join(c.root, "export.json"), rawDataToJson(sample(["c1"])));
    const refused = c.run("restore", ["export.json", "--yes"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /already holds data.*--force/);
    assert.deepEqual(courseIds(await c.read()), ["live"], "nothing changed");

    const dry = c.run("restore", ["export.json", "--force", "--dry-run"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.deepEqual(courseIds(await c.read()), ["live"]);

    const forced = c.run("restore", ["export.json", "--force", "--yes"]);
    assert.equal(forced.code, 0, forced.stderr);
    assert.deepEqual(courseIds(await c.read()), ["c1"]);
    const safety = listBackupFiles(c.backups).find((b) => b.kind === "safety");
    assert.ok(safety, "a safety backup was written");
    assert.deepEqual(courseIds(readBackupData(safety.file).data), ["live"]);

    const latest = c.run("restore", ["latest", "--force", "--yes", "--no-safety-backup"]);
    assert.equal(latest.code, 0, latest.stderr);
    assert.deepEqual(courseIds(await c.read()), ["live"], "'latest' is the safety backup");
  });

  it("db:restore refuses a backup without an administrator unless --allow-no-admin", async () => {
    const c = await setup();
    fs.writeFileSync(path.join(c.root, "students.json"), rawDataToJson({ collections: { users: [{ id: "u9", roles: ["student"], enabled: true }] }, settings: null }));
    const refused = c.run("restore", ["students.json"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /--allow-no-admin/);
    const allowed = c.run("restore", ["students.json", "--allow-no-admin"]);
    assert.equal(allowed.code, 0, allowed.stderr);
  });

  it("db:to-postgres copies an old SQLite database into an empty database, verifies counts and never changes the file", async () => {
    const c = await setup();
    const file = path.join(c.root, "storage", "lms.sqlite");
    await createLegacySqlite(file, sample(["c1", "c2"]));
    const before = fs.readFileSync(file);
    const copied = c.run("copy", []);
    assert.equal(copied.code, 0, copied.stderr);
    assert.match(copied.stdout, /Copied 4 records .* counts verified/);
    const data = await c.read();
    assert.deepEqual(courseIds(data), ["c1", "c2"]);
    assert.deepEqual(data.settings, sample().settings);
    assert.ok(fs.readFileSync(file).equals(before), "the SQLite file is unchanged");

    const again = c.run("copy", []);
    assert.equal(again.code, 1);
    assert.match(again.stderr, /already holds data.*--force/);
    const forced = c.run("copy", ["--force", "--yes"]);
    assert.equal(forced.code, 0, forced.stderr);
  });
});
