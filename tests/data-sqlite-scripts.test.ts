import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RawData } from "@/lib/db/driver";
import { createDatabaseFile, listBackupFiles, openDatabase, rawDataToJson, readAllData } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite item 5: the offline CLI scripts (`npm run db:backup`,
 * `db:restore`, `db:export`) run as real child processes against a
 * temporary storage folder.
 */

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPTS = { backup: "scripts/db-backup.mjs", restore: "scripts/db-restore.mjs", export: "scripts/db-export-json.mjs" } as const;

let dir: string;
let counter = 0;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-scripts-"));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Storage {
  root: string;
  sqlite: string;
  json: string;
  backups: string;
  env: Record<string, string>;
}

/** A storage folder and the environment that points the scripts at it. */
function storage(driver: "sqlite" | "json" = "sqlite"): Storage {
  const root = path.join(dir, `case-${++counter}`);
  fs.mkdirSync(root, { recursive: true });
  const sqlite = path.join(root, "storage", "lms.sqlite");
  const json = path.join(root, "storage", "db.json");
  return {
    root,
    sqlite,
    json,
    backups: path.join(root, "storage", "backups"),
    env: { DB_DRIVER: driver, SQLITE_PATH: sqlite, DATA_FILE: json, INIT_CWD: root, DB_BACKUP_KEEP: "14", DB_AUTO_BACKUP: "true" },
  };
}

function run(script: keyof typeof SCRIPTS, args: string[], s: Storage) {
  const env: NodeJS.ProcessEnv = { ...process.env, ...s.env };
  delete env.NODE_OPTIONS;
  delete env.DEBUG;
  const result = spawnSync(process.execPath, [path.join(ROOT, SCRIPTS[script]), ...args], { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sample(overrides: Partial<Record<string, unknown[]>> = {}): RawData {
  return {
    collections: {
      users: [
        { id: "u1", email: "ada@example.com", name: "Ada", roles: ["admin"], enabled: true },
        { id: "u2", email: "bob@example.com", name: "Bob", roles: ["student"], enabled: true },
      ],
      courses: [{ id: "c1", title: "Intro" }],
      ...overrides,
    },
    settings: { brand: { name: "Script Academy" } },
  };
}

function read(file: string): RawData {
  const conn = openDatabase(file, { readOnly: true });
  try {
    return readAllData(conn);
  } finally {
    conn.close();
  }
}

const courseIds = (data: RawData) => (data.collections.courses ?? []).map((c) => (c as { id: string }).id);

describe("npm run db:backup", () => {
  it("prints help and rejects unknown options", () => {
    const s = storage();
    const help = run("backup", ["--help"], s);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /Usage: npm run db:backup/);
    const bad = run("backup", ["--weekly"], s);
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /Unknown option: --weekly/);
    assert.match(bad.stderr, /Usage:/);
  });

  it("fails clearly when there is no database yet", () => {
    const result = run("backup", [], storage());
    assert.equal(result.code, 1);
    assert.match(result.stderr, /There is no database at/);
    assert.doesNotMatch(result.stderr, /\n\s+at /, "no stack trace");
  });

  it("writes manual and daily backups and lists them", () => {
    const s = storage();
    createDatabaseFile(s.sqlite, sample());

    const manual = run("backup", ["--note", "Before the upgrade"], s);
    assert.equal(manual.code, 0, manual.stderr);
    assert.match(manual.stdout, /Backup written: .*lms-\d{8}-\d{6}-manual\.sqlite/);
    assert.match(manual.stdout, /3 records/);
    assert.match(manual.stdout, /npm run db:restore -- "lms-/);

    const auto = run("backup", ["--auto", "--json"], s);
    assert.equal(auto.code, 0, auto.stderr);
    const report = JSON.parse(auto.stdout) as { created: boolean; records: number; counts: Record<string, number> };
    assert.equal(report.created, true);
    assert.deepEqual(report.counts, { users: 2, courses: 1 });
    const again = run("backup", ["--auto"], s);
    assert.match(again.stdout, /already exists/);

    const backups = listBackupFiles(s.backups);
    assert.deepEqual(backups.map((b) => b.kind).sort(), ["auto", "manual"]);
    assert.equal(backups.find((b) => b.kind === "manual")?.manifest?.reason, "Before the upgrade");
    assert.equal(backups.find((b) => b.kind === "manual")?.manifest?.createdBy, "db:backup script");

    const list = run("backup", ["--list"], s);
    assert.equal(list.code, 0);
    for (const b of backups) assert.ok(list.stdout.includes(b.name), list.stdout);

    const out = run("backup", ["--out", "copies/site.sqlite"], s);
    assert.equal(out.code, 0, out.stderr);
    assert.deepEqual(courseIds(read(path.join(s.root, "copies", "site.sqlite"))), ["c1"], "--out is relative to where the command ran");
    assert.equal(run("backup", ["--auto", "--out", "x.sqlite"], s).code, 2);
  });

  it("backs up the JSON driver's file", () => {
    const s = storage("json");
    fs.mkdirSync(path.dirname(s.json), { recursive: true });
    fs.writeFileSync(s.json, rawDataToJson(sample()));
    const result = run("backup", [], s);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(listBackupFiles(s.backups)[0]?.format, "json");
  });
});

describe("npm run db:export", () => {
  it("exports to a file, to the backups folder and to stdout", () => {
    const s = storage();
    createDatabaseFile(s.sqlite, sample());

    const toFile = run("export", ["--out", "export.json", "--counts"], s);
    assert.equal(toFile.code, 0, toFile.stderr);
    assert.match(toFile.stdout, /Exported 3 records/);
    assert.match(toFile.stdout, /users\s+2/);
    const exported = JSON.parse(fs.readFileSync(path.join(s.root, "export.json"), "utf8"));
    assert.deepEqual(exported.settings, { brand: { name: "Script Academy" } });

    const exists = run("export", ["--out", "export.json"], s);
    assert.equal(exists.code, 1);
    assert.match(exists.stderr, /already exists/);

    const listed = run("export", ["--compact"], s);
    assert.equal(listed.code, 0, listed.stderr);
    assert.equal(listBackupFiles(s.backups)[0]?.format, "json");

    const stdout = run("export", ["--stdout", "--compact"], s);
    assert.equal(stdout.code, 0, stdout.stderr);
    assert.equal(JSON.parse(stdout.stdout).users.length, 2);
    assert.equal(run("export", ["--stdout", "--out", "x.json"], s).code, 2);
  });
});

describe("npm run db:restore", () => {
  function prepared(): { s: Storage; source: string } {
    const s = storage();
    createDatabaseFile(s.sqlite, sample());
    const source = path.join(s.root, "backup.json");
    fs.writeFileSync(source, rawDataToJson(sample({ courses: [{ id: "c7", title: "From the backup" }, { id: "c8", title: "Also" }] })));
    return { s, source };
  }

  it("needs a backup argument", () => {
    const result = run("restore", [], storage());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Which backup should be restored/);
  });

  it("shows what would change on a dry run and changes nothing", () => {
    const { s } = prepared();
    const result = run("restore", ["backup.json", "--dry-run"], s);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /courses\s+1\s+2/);
    assert.match(result.stdout, /Dry run: nothing was changed/);
    assert.deepEqual(courseIds(read(s.sqlite)), ["c1"]);
  });

  it("refuses to run without confirmation when there is no terminal", () => {
    const { s } = prepared();
    const result = run("restore", ["backup.json"], s);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /--yes/);
    assert.deepEqual(courseIds(read(s.sqlite)), ["c1"]);
  });

  it("restores with --yes after a safety backup, and 'latest' finds it again", () => {
    const { s } = prepared();
    const result = run("restore", ["backup.json", "--yes"], s);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Restored 4 records/);
    assert.match(result.stdout, /previous data is kept as .*safety\.sqlite/);
    assert.deepEqual(courseIds(read(s.sqlite)), ["c7", "c8"]);

    // The safety backup is now the newest: restoring "latest" undoes the restore.
    const undo = run("restore", ["latest", "-y", "--no-safety-backup"], s);
    assert.equal(undo.code, 0, undo.stderr);
    assert.deepEqual(courseIds(read(s.sqlite)), ["c1"]);
  });

  it("refuses a backup without an administrator unless --force", () => {
    const s = storage();
    createDatabaseFile(s.sqlite, sample());
    fs.writeFileSync(path.join(s.root, "students.json"), rawDataToJson(sample({ users: [{ id: "u2", roles: ["student"] }] })));
    const refused = run("restore", ["students.json", "--yes"], s);
    assert.equal(refused.code, 1);
    assert.match(refused.stdout, /Problem: .*no enabled administrator/);
    assert.match(refused.stderr, /--force/);
    assert.equal(read(s.sqlite).collections.users?.length, 2);

    const forced = run("restore", ["students.json", "--yes", "--force"], s);
    assert.equal(forced.code, 0, forced.stderr);
    assert.equal(read(s.sqlite).collections.users?.length, 1);
  });

  it("rebuilds a damaged database and keeps the damaged file", () => {
    const { s } = prepared();
    fs.writeFileSync(s.sqlite, Buffer.alloc(8192, 0x33));
    const result = run("restore", ["backup.json", "--yes"], s);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /damaged, will be moved aside/);
    assert.match(result.stdout, /damaged file was kept as .*lms\.sqlite\.damaged-/);
    assert.deepEqual(courseIds(read(s.sqlite)), ["c7", "c8"]);
    assert.equal(fs.readdirSync(path.dirname(s.sqlite)).filter((name) => name.includes(".damaged-")).length, 1);
  });

  it("reports a backup that cannot be found", () => {
    const result = run("restore", ["nothing-here.sqlite", "--yes"], storage());
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Backup not found/);
  });
});
