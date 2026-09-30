import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countRows, openDatabase, readAllData, readMeta, type RawData } from "@/lib/db/sqlite-core.mjs";

/**
 * data-sqlite items 3–4 through the real store module (`@/lib/db/store`):
 * what happens on the very first start with each combination of files and
 * settings, and that the store API (`insert`, `update`, `remove`,
 * `removeWhere`, `mutate`, …) round-trips through SQLite.
 *
 * The store is one per process and reads its configuration when it is
 * imported, so every start runs in a child process with its own environment.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKER = "@@RESULT@@";

let dir: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ll-sqlite-first-start-"));
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
function storage(): { folder: string; sqlite: string; json: string } {
  counter++;
  const folder = path.join(dir, `case-${counter}`);
  fs.mkdirSync(folder, { recursive: true });
  return { folder, sqlite: path.join(folder, "lms.sqlite"), json: path.join(folder, "db.json") };
}

interface Run<T> {
  status: number | null;
  result: T;
  output: string;
}

/**
 * Start the app's store in a fresh process with `env` and run `body` (the
 * body of an async function that receives `store` and returns JSON data).
 */
function start<T = Record<string, unknown>>(env: Record<string, string | null>, body: string): Run<T> {
  const script = [
    "const env = JSON.parse(process.env.LL_FIRST_START_ENV);",
    "for (const [key, value] of Object.entries(env)) {",
    "  if (value === null) delete process.env[key];",
    "  else process.env[key] = value;",
    "}",
    'const store = await import("@/lib/db/store");',
    `const result = await (async () => {\n${body}\n})();`,
    "await store.flush();",
    `console.log(${JSON.stringify(MARKER)} + JSON.stringify(result ?? null));`,
  ].join("\n");
  const child = spawnSync(
    process.execPath,
    ["--experimental-transform-types", "--disable-warning=ExperimentalWarning", "--import", "./tests/register.mjs", "--input-type=module", "-e", script],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, LL_FIRST_START_ENV: JSON.stringify(env) }, timeout: 120_000 },
  );
  const output = `${child.stdout}\n${child.stderr}`;
  const line = child.stdout.split("\n").find((l) => l.startsWith(MARKER));
  return { status: child.status, result: (line ? JSON.parse(line.slice(MARKER.length)) : null) as T, output };
}

function sqliteEnv(paths: { sqlite: string; json: string }, extra: Record<string, string | null> = {}): Record<string, string | null> {
  return { DB_DRIVER: "sqlite", SQLITE_PATH: paths.sqlite, DATA_FILE: paths.json, SEED_DEMO_DATA: "true", ADMIN_NAME: null, ADMIN_EMAIL: null, ADMIN_PASSWORD: null, ...extra };
}

function readSqlite(file: string): { data: RawData; counts: Record<string, number>; meta: Record<string, string> } {
  const conn = openDatabase(file, { readOnly: true });
  try {
    return { data: readAllData(conn), counts: countRows(conn), meta: readMeta(conn) };
  } finally {
    conn.close();
  }
}

const archives = (folder: string) => fs.readdirSync(folder).filter((name) => name.startsWith("db.json.migrated-"));

type Row = Record<string, unknown> & { id: string };

describe("first start of the store", { concurrency: true }, () => {
  it("imports db.json, keeps it as db.json.migrated-<timestamp> and serves the whole store API from SQLite", () => {
    const paths = storage();
    const legacy = {
      users: [
        { id: "usr_ada", username: "ada", name: "Ada", email: "ada@example.com", roles: ["admin"], enabled: true },
        { id: "usr_bob", username: "bob", name: "Bob", email: "bob@example.com", roles: ["student"], enabled: true },
        { id: "usr_cy", username: "cy", name: "Cy", email: "cy@example.com", roles: ["student"], enabled: true },
      ],
      courses: [{ id: "crs_1", slug: "intro", title: "Intro", instructorIds: ["usr_ada"], tags: [] }],
      settings: { brand: { name: "Imported Academy" }, learning: { videoCompletionThreshold: 75 } },
    };
    const text = JSON.stringify(legacy, null, 2);
    fs.writeFileSync(paths.json, text, "utf8");

    const first = start<{
      origin: string;
      before: { users: string[]; brand: string; threshold: number; accent: string; collections: number };
      removed: boolean;
      removedAgain: boolean;
      removedMany: number;
      updated: string;
      missing: null;
      counts: { categories: number; admins: number };
      found: string;
      filtered: string[];
      exported: { users: string[]; brand: string };
    }>(
      sqliteEnv(paths),
      `
      const db = await store.getDb();
      const origin = store.getStoreStats().origin;
      const before = {
        users: db.users.map((u) => u.id),
        brand: db.settings.brand.name,
        threshold: db.settings.learning.videoCompletionThreshold,
        accent: db.settings.brand.accentColor,
        collections: store.COLLECTIONS.filter((name) => Array.isArray(db[name])).length,
      };
      await store.insert("categories", { id: "cat_1", slug: "design", name: "Design" });
      await store.insertMany("categories", [{ id: "cat_2", slug: "code", name: "Code" }, { id: "cat_3", slug: "data", name: "Data" }]);
      const updated = (await store.update("users", "usr_ada", { name: "Ada Lovelace" })).name;
      await store.update("users", "usr_bob", (u) => ({ name: u.name + " Jr." }));
      const missing = await store.update("users", "nobody", { name: "x" });
      const removed = await store.remove("categories", "cat_2");
      const removedAgain = await store.remove("categories", "cat_2");
      const removedMany = await store.removeWhere("users", (u) => u.id === "usr_cy");
      await store.mutate((d) => {
        const course = d.courses.find((c) => c.id === "crs_1");
        course.title = "Renamed in place";
        course.tags.push("edited");
        d.settings.brand.name = "Renamed Academy";
      });
      const counts = { categories: await store.count("categories"), admins: await store.count("users", (u) => u.roles.includes("admin")) };
      const found = (await store.findOne("categories", (c) => c.slug === "data")).id;
      const filtered = (await store.filter("users", (u) => u.enabled)).map((u) => u.id);
      const json = JSON.parse(await store.exportDatabase());
      return { origin, before, removed, removedAgain, removedMany, updated, missing, counts, found, filtered, exported: { users: json.users.map((u) => u.name), brand: json.settings.brand.name } };
      `,
    );
    assert.equal(first.status, 0, first.output);
    assert.equal(first.result.origin, "imported-json");
    assert.deepEqual(first.result.before.users, ["usr_ada", "usr_bob", "usr_cy"]);
    assert.equal(first.result.before.brand, "Imported Academy");
    assert.equal(first.result.before.threshold, 75);
    assert.equal(first.result.before.accent, "#4f46e5", "settings missing from the old file get their defaults");
    assert.ok(first.result.before.collections > 80, "every collection exists");
    assert.deepEqual(
      { ...first.result, before: undefined, origin: undefined },
      {
        before: undefined,
        origin: undefined,
        removed: true,
        removedAgain: false,
        removedMany: 1,
        updated: "Ada Lovelace",
        missing: null,
        counts: { categories: 2, admins: 1 },
        found: "cat_3",
        filtered: ["usr_ada", "usr_bob"],
        exported: { users: ["Ada Lovelace", "Bob Jr."], brand: "Renamed Academy" },
      },
    );
    assert.match(first.output, /imported 4 document\(s\) from db\.json/);

    // The JSON file was renamed, not deleted or rewritten.
    assert.equal(fs.existsSync(paths.json), false);
    const kept = archives(paths.folder);
    assert.equal(kept.length, 1);
    assert.equal(fs.readFileSync(path.join(paths.folder, kept[0]!), "utf8"), text);

    // Everything the API did is in the SQLite file.
    const stored = readSqlite(paths.sqlite);
    const users = stored.data.collections.users as Row[];
    assert.deepEqual(
      users.map((u) => [u.id, u.name]),
      [
        ["usr_ada", "Ada Lovelace"],
        ["usr_bob", "Bob Jr."],
      ],
    );
    assert.deepEqual(
      (stored.data.collections.categories as Row[]).map((c) => c.id),
      ["cat_1", "cat_3"],
    );
    assert.deepEqual((stored.data.collections.courses as Row[])[0], { id: "crs_1", slug: "intro", title: "Renamed in place", instructorIds: ["usr_ada"], tags: ["edited"] });
    const settings = stored.data.settings as { brand: { name: string }; learning: { videoCompletionThreshold: number } };
    assert.equal(settings.brand.name, "Renamed Academy");
    assert.equal(settings.learning.videoCompletionThreshold, 75);
    assert.equal(stored.meta.initialized_from, "json:db.json");
    assert.equal(stored.meta.legacy_json_archive, kept[0]);
    assert.ok(Object.keys(stored.counts).length > 80, "a table for every collection");

    // The next start reads SQLite: no import, no seed, no JSON file.
    const second = start<{ origin: string; users: string[]; title: string }>(
      sqliteEnv(paths),
      `
      const db = await store.getDb();
      return { origin: store.getStoreStats().origin, users: db.users.map((u) => u.name), title: db.courses[0].title };
      `,
    );
    assert.equal(second.status, 0, second.output);
    assert.deepEqual(second.result, { origin: "existing", users: ["Ada Lovelace", "Bob Jr."], title: "Renamed in place" });
    assert.deepEqual(archives(paths.folder), kept);
    assert.equal(fs.existsSync(paths.json), false);
  });

  it("seeds the demo site when there is neither a SQLite database nor a JSON file, exactly once", () => {
    const paths = storage();
    const first = start<{ origin: string; users: number; courses: number; lessons: number; admin: boolean; brand: string; marker: string }>(
      sqliteEnv(paths),
      `
      const db = await store.getDb();
      return {
        origin: store.getStoreStats().origin,
        users: db.users.length,
        courses: db.courses.length,
        lessons: db.lessons.length,
        admin: db.users.some((u) => u.roles.includes("admin")),
        brand: db.settings.brand.name,
        marker: (await store.insert("categories", { id: "cat_marker", slug: "marker", name: "Added after seeding" })).id,
      };
      `,
    );
    assert.equal(first.status, 0, first.output);
    assert.equal(first.result.origin, "seeded");
    assert.ok(first.result.users > 1 && first.result.courses > 0 && first.result.lessons > 0, "demo content is present");
    assert.equal(first.result.admin, true);
    assert.equal(fs.existsSync(paths.json), false, "no JSON file is created");
    assert.deepEqual(archives(paths.folder), []);

    const stored = readSqlite(paths.sqlite);
    assert.equal(stored.meta.initialized_from, "seed");
    assert.equal(stored.counts.users, first.result.users);
    assert.equal(stored.counts.courses, first.result.courses);
    assert.equal(stored.counts.lessons, first.result.lessons);
    assert.equal((stored.data.settings as { brand: { name: string } }).brand.name, first.result.brand);

    // A restart keeps the data as it was left (nothing is seeded again); a demo reset replaces it in place.
    const hasMarker = "db.categories.some((c) => c.id === 'cat_marker')";
    const second = start<{ origin: string; users: number; marker: boolean; afterReset: { users: number; courses: number; marker: boolean } }>(
      sqliteEnv(paths),
      `
      const db = await store.getDb();
      const origin = store.getStoreStats().origin;
      const users = db.users.length;
      const marker = ${hasMarker};
      await store.resetDatabase();
      return { origin, users, marker, afterReset: { users: db.users.length, courses: db.courses.length, marker: ${hasMarker} } };
      `,
    );
    assert.equal(second.status, 0, second.output);
    assert.deepEqual(second.result, {
      origin: "existing",
      users: first.result.users,
      marker: true,
      afterReset: { users: first.result.users, courses: first.result.courses, marker: false },
    });
    const reset = readSqlite(paths.sqlite);
    assert.equal(reset.meta.last_replaced_from, "demo-reset");
    assert.equal(reset.counts.users, first.result.users);
    assert.equal((reset.data.collections.categories as Row[]).some((c) => c.id === "cat_marker"), false);
  });

  it("creates only the bootstrap admin when SEED_DEMO_DATA=false, and says what is missing when it is not configured", () => {
    const paths = storage();
    const failed = start(sqliteEnv(paths, { SEED_DEMO_DATA: "false" }), "await store.getDb();");
    assert.notEqual(failed.status, 0);
    assert.match(failed.output, /SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD/);

    // The failed start left no half-made database: the next one bootstraps normally.
    const run = start<{ origin: string; users: Row[]; courses: number; brand: string }>(
      sqliteEnv(paths, { SEED_DEMO_DATA: "false", ADMIN_NAME: "Site Owner", ADMIN_EMAIL: "Owner@Example.com", ADMIN_PASSWORD: "a long enough password" }),
      `
      const db = await store.getDb();
      return { origin: store.getStoreStats().origin, users: db.users, courses: db.courses.length, brand: db.settings.brand.name };
      `,
    );
    assert.equal(run.status, 0, run.output);
    assert.equal(run.result.origin, "seeded");
    assert.equal(run.result.courses, 0);
    assert.equal(run.result.brand, "LearnLoop");
    assert.equal(run.result.users.length, 1);
    const admin = run.result.users[0]!;
    assert.equal(admin.name, "Site Owner");
    assert.equal(admin.email, "owner@example.com");
    assert.equal(admin.username, "owner");
    assert.deepEqual(admin.roles, ["admin", "moderator", "course_creator", "batch_evaluator"]);
    assert.ok(typeof admin.passwordHash === "string" && !admin.passwordHash.includes("a long enough password"));

    const stored = readSqlite(paths.sqlite);
    assert.deepEqual(stored.data.collections.users, run.result.users);
    assert.equal(Object.values(stored.counts).reduce((a, b) => a + b, 0), 1, "nothing but the admin account");
    assert.equal(fs.existsSync(paths.json), false);
  });

  it("leaves db.json alone with DB_DRIVER=json", () => {
    const paths = storage();
    fs.writeFileSync(paths.json, JSON.stringify({ users: [{ id: "usr_ada", name: "Ada", roles: ["admin"] }] }), "utf8");
    const run = start<{ driver: string; origin: string }>(
      sqliteEnv(paths, { DB_DRIVER: "json" }),
      `
      await store.update("users", "usr_ada", { name: "Ada, still in JSON" });
      return { driver: store.getStoreStats().driver, origin: store.getStoreStats().origin };
      `,
    );
    assert.equal(run.status, 0, run.output);
    assert.deepEqual(run.result, { driver: "json", origin: "existing" });
    assert.equal(JSON.parse(fs.readFileSync(paths.json, "utf8")).users[0].name, "Ada, still in JSON");
    assert.deepEqual(fs.readdirSync(paths.folder), ["db.json"], "no SQLite file, no archive");
  });
});
