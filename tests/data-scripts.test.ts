import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RawData } from "@/lib/db/driver";
import { assertCollectionName, rawDataFromJson, rawDataToJson } from "@/lib/db/data-core.mjs";
import { resolveConfig } from "../scripts/lib/cli.mjs";
import { requireDatabaseUrl } from "../scripts/lib/pg.mjs";
import { detectSourceFormat, readSourceDatabase } from "../scripts/lib/sqlite-source.mjs";
import { createLegacySqlite, openSqlite } from "./helpers/legacy-sqlite";

/**
 * The parts of the database scripts that need no database server: the JSON
 * export format, the scripts' configuration, reading an old SQLite or JSON
 * database for `npm run db:to-postgres`, and the scripts' command-line
 * behaviour up to the point where they would connect. The PostgreSQL side
 * is covered by `tests/postgres-scripts.test.ts` (TEST_DATABASE_URL).
 *
 * Every script run gets an explicit, unreachable DATABASE_URL, so the
 * project's own `.env` can never point a test at a real database.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = {
  backup: "scripts/db-backup.mjs",
  restore: "scripts/db-restore.mjs",
  export: "scripts/db-export-json.mjs",
  copy: "scripts/db-copy-to-postgres.mjs",
} as const;
const UNREACHABLE = "postgresql://nobody:secret@127.0.0.1:9/none";

let dir: string;
let counter = 0;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-scripts-"));
});

after(() => {
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
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
      ],
      courses: [{ id: "c1", title: "Intro", tags: ["a"] }],
      oldThings: [{ id: "x1" }],
    },
    settings: { brand: { name: "Script Academy" } },
  };
}

function run(script: keyof typeof SCRIPTS, args: string[], root: string, extraEnv: Record<string, string> = {}) {
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: UNREACHABLE, STORAGE_DIR: path.join(root, "storage"), INIT_CWD: root, ...extraEnv };
  delete env.NODE_OPTIONS;
  delete env.DEBUG;
  const result = spawnSync(process.execPath, [path.join(ROOT, SCRIPTS[script]), ...args], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("collection names", () => {
  it("accepts identifiers and rejects reserved or unsafe names", () => {
    for (const ok of ["users", "quizSubmissions", "a_b2"]) assert.doesNotThrow(() => assertCollectionName(ok));
    for (const bad of ["", "meta", "Settings", "2fast", "a-b", 'x"; DROP TABLE users; --', "a".repeat(64)]) {
      assert.throws(() => assertCollectionName(bad), /cannot be used as a collection name/, bad);
    }
  });
});

describe("JSON exports", () => {
  it("round-trip with the settings last", () => {
    const data = rawDataFromJson({ users: [{ id: "u1", name: "A" }], courses: [], settings: { siteName: "X" }, version: 3 });
    assert.deepEqual(data, { collections: { users: [{ id: "u1", name: "A" }], courses: [] }, settings: { siteName: "X" } });
    const text = rawDataToJson(data);
    assert.deepEqual(Object.keys(JSON.parse(text)), ["users", "courses", "settings"]);
    assert.deepEqual(rawDataFromJson(JSON.parse(text)), data);
    assert.equal(rawDataToJson(data, false).includes("\n"), false);
  });

  it("reject documents without an id and non-database files", () => {
    assert.throws(() => rawDataFromJson({ users: [{ id: "u1" }, { name: "no id" }] }), /"users", item 2 has no id/);
    assert.throws(() => rawDataFromJson([]), /expected a JSON object/);
    assert.throws(() => rawDataFromJson({ "bad-name": [] }), /cannot be used as a collection name/);
  });
});

describe("script configuration", () => {
  const cwd = path.resolve("/srv/app");

  it("reads DATABASE_URL and keeps backups in STORAGE_DIR/backups (default storage/backups)", () => {
    assert.deepEqual(resolveConfig({}, cwd), { databaseUrl: "", storageDir: path.join(cwd, "storage"), backupsDir: path.join(cwd, "storage", "backups") });
    const custom = resolveConfig({ DATABASE_URL: " postgresql://u@h/db ", STORAGE_DIR: "/var/lib/ll" }, cwd);
    assert.equal(custom.databaseUrl, "postgresql://u@h/db");
    assert.equal(custom.backupsDir, path.join(path.resolve(cwd, "/var/lib/ll"), "backups"));
  });

  it("needs a postgresql:// DATABASE_URL and says where to find it", () => {
    assert.throws(() => requireDatabaseUrl(""), /Set DATABASE_URL.*ENV-SETUP\.md/);
    assert.throws(() => requireDatabaseUrl("mysql://x"), /postgresql:\/\//);
    assert.equal(requireDatabaseUrl(" postgres://u@h/db "), "postgres://u@h/db");
  });
});

describe("reading an old database (npm run db:to-postgres)", () => {
  it("reads a SQLite database of the old layout in row order, without changing the file", async () => {
    const file = path.join(folder(), "lms.sqlite");
    await createLegacySqlite(file, sample());
    const before = sha(file);
    assert.equal(detectSourceFormat(file), "sqlite");
    const { format, data } = await readSourceDatabase(file);
    assert.equal(format, "sqlite");
    assert.deepEqual(data, sample());
    assert.equal(sha(file), before, "the source is never changed");
  });

  it("removes the -wal/-shm files a read created, but never ones that were there", async () => {
    const root = folder();
    const file = path.join(root, "lms.sqlite");
    await createLegacySqlite(file, sample(), { wal: true });
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
    await readSourceDatabase(file);
    assert.deepEqual(fs.readdirSync(root), ["lms.sqlite"]);
    fs.writeFileSync(`${file}-wal`, "");
    await readSourceDatabase(file);
    assert.ok(fs.existsSync(`${file}-wal`));
  });

  it("reads JSON exports (db.json, downloaded backups) and refuses anything else", async () => {
    const root = folder();
    const json = path.join(root, "db.json");
    fs.writeFileSync(json, `﻿${rawDataToJson(sample())}`);
    assert.deepEqual(await readSourceDatabase(json), { format: "json", data: sample() });
    const text = path.join(root, "notes.txt");
    fs.writeFileSync(text, "hello");
    await assert.rejects(readSourceDatabase(text), /neither a SQLite database nor a JSON export/);
  });

  it("refuses a SQLite file that this app did not make", async () => {
    const file = path.join(folder(), "other.sqlite");
    const db = await openSqlite(file);
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    db.close();
    await assert.rejects(readSourceDatabase(file), /not created by this app/);
  });
});

describe("the scripts before they connect", () => {
  it("print help, reject unknown options and list JSON backups only", () => {
    const root = folder();
    for (const script of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
      const help = run(script, ["--help"], root);
      assert.equal(help.code, 0, script);
      assert.match(help.stdout, /^Usage: npm run db:/, script);
    }
    const bad = run("backup", ["--weekly"], root);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /Unknown option: --weekly/);

    const backups = path.join(root, "storage", "backups");
    fs.mkdirSync(backups, { recursive: true });
    fs.writeFileSync(path.join(backups, "lms-20260930-auto.sqlite"), "old SQLite backup");
    fs.writeFileSync(path.join(backups, "lms-20261001-auto.json"), rawDataToJson(sample()));
    const list = run("backup", ["--list"], root);
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /lms-20261001-auto\.json/);
    assert.doesNotMatch(list.stdout, /\.sqlite/);
  });

  it("db:restore points SQLite files to db:to-postgres before touching the database", async () => {
    const root = folder();
    const file = path.join(root, "old.sqlite");
    await createLegacySqlite(file, sample());
    const result = run("restore", ["old.sqlite", "--force", "--yes"], root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /db:to-postgres/);
    assert.doesNotMatch(result.stderr, /reach database server/, "it stopped before connecting");
  });

  it("db:restore needs a backup", () => {
    const result = run("restore", [], folder());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Which backup should be restored/);
  });

  it("db:to-postgres finds storage/lms.sqlite, else db.json, else the newest db.json.migrated-* copy", () => {
    const root = folder();
    const storage = path.join(root, "storage");
    const none = run("copy", ["--dry-run"], root);
    assert.equal(none.code, 2);
    assert.match(none.stderr, /No old database found/);

    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, "db.json.migrated-2026-09-01T00-00-00-000Z"), rawDataToJson({ collections: { users: [{ id: "old" }] }, settings: null }));
    const migrated = run("copy", ["--dry-run"], root);
    assert.match(migrated.stdout, /db\.json\.migrated-2026-09-01T00-00-00-000Z \(JSON, 1 records/);

    fs.writeFileSync(path.join(storage, "db.json"), rawDataToJson(sample()));
    const json = run("copy", ["--dry-run"], root);
    assert.match(json.stdout, /db\.json \(JSON, 3 records, with settings\)/);
    assert.match(json.stderr, /Skipped \(no table in this version\): oldThings/);
    // Unreachable target: it reads the source, then fails to connect, and nothing is written anywhere.
    assert.equal(json.code, 1);
  });
});
