import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * The real store module (`@/lib/db/store`) on a brand-new database: what
 * the first start stores with each SEED_DEMO_DATA setting, that a restart
 * reads the data back instead of seeding again, that the store API
 * (`insert`, `update`, `remove`, `removeWhere`, `mutate`, …) round-trips
 * through the driver, and that the in-memory test driver can never be
 * selected outside a test run.
 *
 * The store reads its configuration when it is imported, so every case runs
 * in a child process with its own environment (on the in-memory test
 * driver that `tests/register.mjs` installs).
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MARKER = "@@RESULT@@";

interface Run<T> {
  status: number | null;
  result: T;
  output: string;
}

/**
 * Run `body` (the body of an async function that receives `store` and the
 * test-database helpers `mem`, and returns JSON data) in a fresh process
 * with `env`.
 */
function start<T = Record<string, unknown>>(env: Record<string, string | null>, body: string): Run<T> {
  const script = [
    "const env = JSON.parse(process.env.LL_FIRST_START_ENV);",
    "for (const [key, value] of Object.entries(env)) {",
    "  if (value === null) delete process.env[key];",
    "  else process.env[key] = value;",
    "}",
    'const mem = await import("./tests/helpers/memory-driver.ts");',
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

const demoEnv = (extra: Record<string, string | null> = {}) => ({ SEED_DEMO_DATA: "true", ADMIN_NAME: null, ADMIN_EMAIL: null, ADMIN_PASSWORD: null, ...extra });

type Row = Record<string, unknown> & { id: string };

describe("first start of the store", { concurrency: true }, () => {
  it("serves the whole store API from the database and keeps it across a restart", () => {
    const run = start<{
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
      stored: { users: [string, string][]; categories: string[]; course: Row; brand: string; threshold: number; tables: number };
      restart: { origin: string; users: string[]; title: string };
    }>(
      demoEnv(),
      `
      const database = mem.useNewTestDatabase();
      database.replace({
        collections: {
          users: [
            { id: "usr_ada", username: "ada", name: "Ada", email: "ada@example.com", roles: ["admin"], enabled: true },
            { id: "usr_bob", username: "bob", name: "Bob", email: "bob@example.com", roles: ["student"], enabled: true },
            { id: "usr_cy", username: "cy", name: "Cy", email: "cy@example.com", roles: ["student"], enabled: true },
          ],
          courses: [{ id: "crs_1", slug: "intro", title: "Intro", instructorIds: ["usr_ada"], tags: [] }],
        },
        settings: { brand: { name: "Existing Academy" }, learning: { videoCompletionThreshold: 75 } },
      }, store.COLLECTIONS, "fixture");
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
      await store.flush();

      const saved = database.read(store.COLLECTIONS);
      const stored = {
        users: saved.collections.users.map((u) => [u.id, u.name]),
        categories: saved.collections.categories.map((c) => c.id),
        course: saved.collections.courses[0],
        brand: saved.settings.brand.name,
        threshold: saved.settings.learning.videoCompletionThreshold,
        tables: Object.keys(database.counts()).length,
      };

      mem.reopenTestDatabase();
      const again = await store.getDb();
      const restart = { origin: store.getStoreStats().origin, users: again.users.map((u) => u.name), title: again.courses[0].title };
      return { origin, before, removed, removedAgain, removedMany, updated, missing, counts, found, filtered, exported: { users: json.users.map((u) => u.name), brand: json.settings.brand.name }, stored, restart };
      `,
    );
    assert.equal(run.status, 0, run.output);
    const { origin, before, stored, restart, ...api } = run.result;
    assert.equal(origin, "existing");
    assert.deepEqual(before.users, ["usr_ada", "usr_bob", "usr_cy"]);
    assert.equal(before.brand, "Existing Academy");
    assert.equal(before.threshold, 75);
    assert.equal(before.accent, "#4f46e5", "settings missing from the stored row get their defaults");
    assert.ok(before.collections > 80, "every collection exists");
    assert.deepEqual(api, {
      removed: true,
      removedAgain: false,
      removedMany: 1,
      updated: "Ada Lovelace",
      missing: null,
      counts: { categories: 2, admins: 1 },
      found: "cat_3",
      filtered: ["usr_ada", "usr_bob"],
      exported: { users: ["Ada Lovelace", "Bob Jr."], brand: "Renamed Academy" },
    });
    // Everything the API did reached the driver.
    assert.deepEqual(stored.users, [
      ["usr_ada", "Ada Lovelace"],
      ["usr_bob", "Bob Jr."],
    ]);
    assert.deepEqual(stored.categories, ["cat_1", "cat_3"]);
    assert.deepEqual(stored.course, { id: "crs_1", slug: "intro", title: "Renamed in place", instructorIds: ["usr_ada"], tags: ["edited"] });
    assert.equal(stored.brand, "Renamed Academy");
    assert.equal(stored.threshold, 75);
    assert.ok(stored.tables > 80, "every collection is stored");
    // A restart reads the database: nothing is seeded.
    assert.deepEqual(restart, { origin: "existing", users: ["Ada Lovelace", "Bob Jr."], title: "Renamed in place" });
  });

  it("seeds the demo site into an empty database exactly once", () => {
    const run = start<{
      first: { origin: string; users: number; courses: number; lessons: number; admin: boolean; brand: string; marker: string };
      meta: Record<string, string>;
      counts: Record<string, number>;
      second: { origin: string; users: number; marker: boolean };
      afterReset: { users: number; courses: number; marker: boolean; meta: Record<string, string> };
    }>(
      demoEnv(),
      `
      const database = mem.useNewTestDatabase({ initialized: false });
      const db = await store.getDb();
      const first = {
        origin: store.getStoreStats().origin,
        users: db.users.length,
        courses: db.courses.length,
        lessons: db.lessons.length,
        admin: db.users.some((u) => u.roles.includes("admin")),
        brand: db.settings.brand.name,
        marker: (await store.insert("categories", { id: "cat_marker", slug: "marker", name: "Added after seeding" })).id,
      };
      await store.flush();
      const meta = { ...database.meta };
      const counts = database.counts();

      mem.reopenTestDatabase();
      const again = await store.getDb();
      const second = { origin: store.getStoreStats().origin, users: again.users.length, marker: again.categories.some((c) => c.id === "cat_marker") };
      await store.resetDatabase();
      const afterReset = { users: again.users.length, courses: again.courses.length, marker: again.categories.some((c) => c.id === "cat_marker"), meta: { ...database.meta } };
      return { first, meta, counts, second, afterReset };
      `,
    );
    assert.equal(run.status, 0, run.output);
    const { first, meta, counts, second, afterReset } = run.result;
    assert.equal(first.origin, "seeded");
    assert.ok(first.users > 1 && first.courses > 0 && first.lessons > 0, "demo content is present");
    assert.equal(first.admin, true);
    assert.equal(meta.initialized_from, "seed");
    assert.equal(counts.users, first.users);
    assert.equal(counts.courses, first.courses);
    assert.equal(counts.lessons, first.lessons);
    assert.match(run.output, /filled the new database/);
    // A restart keeps the data as it was left (nothing is seeded again); a demo reset replaces it in place.
    assert.deepEqual(second, { origin: "existing", users: first.users, marker: true });
    assert.equal(afterReset.users, first.users);
    assert.equal(afterReset.courses, first.courses);
    assert.equal(afterReset.marker, false);
    assert.equal(afterReset.meta.last_replaced_from, "demo-reset");
  });

  it("creates only the bootstrap admin when SEED_DEMO_DATA=false, and says what is missing when it is not configured", () => {
    const failed = start<{ message: string; initialized: boolean; counts: Record<string, number> }>(
      demoEnv({ SEED_DEMO_DATA: "false" }),
      `
      const database = mem.useNewTestDatabase({ initialized: false });
      const message = await store.getDb().then(() => "opened", (err) => err.message);
      return { message, initialized: database.initialized, counts: database.counts() };
      `,
    );
    assert.equal(failed.status, 0, failed.output);
    assert.match(failed.result.message, /SEED_DEMO_DATA=false requires ADMIN_EMAIL and ADMIN_PASSWORD/);
    assert.equal(failed.result.initialized, false, "the failed start left the database empty, so the next start fills it");
    assert.deepEqual(failed.result.counts, {});

    const run = start<{ origin: string; users: Row[]; courses: number; brand: string; records: number }>(
      demoEnv({ SEED_DEMO_DATA: "false", ADMIN_NAME: "Site Owner", ADMIN_EMAIL: "Owner@Example.com", ADMIN_PASSWORD: "a long enough password" }),
      `
      const database = mem.useNewTestDatabase({ initialized: false });
      const db = await store.getDb();
      await store.flush();
      const records = Object.values(database.counts()).reduce((a, b) => a + b, 0);
      return { origin: store.getStoreStats().origin, users: db.users, courses: db.courses.length, brand: db.settings.brand.name, records };
      `,
    );
    assert.equal(run.status, 0, run.output);
    assert.equal(run.result.origin, "seeded");
    assert.equal(run.result.courses, 0);
    assert.equal(run.result.brand, "LearnLoop");
    assert.equal(run.result.users.length, 1);
    assert.equal(run.result.records, 1, "nothing but the admin account");
    const admin = run.result.users[0]!;
    assert.equal(admin.name, "Site Owner");
    assert.equal(admin.email, "owner@example.com");
    assert.equal(admin.username, "owner");
    assert.deepEqual(admin.roles, ["admin", "moderator", "course_creator", "batch_evaluator"]);
    assert.ok(typeof admin.passwordHash === "string" && !admin.passwordHash.includes("a long enough password"));
  });

  it("never uses the in-memory test driver outside a test run: the app needs DATABASE_URL", () => {
    const run = start<{ target: string; message: string; install: string }>(
      { NODE_ENV: "production", DATABASE_URL: null },
      `
      // What the app sees without the test bootstrap's hook.
      delete globalThis.__llTestStore;
      const target = store.databaseTarget();
      const message = await store.getDb().then(() => "opened", (err) => err.message);
      let install = "installed";
      try { mem.installMemoryStore(); } catch (err) { install = err.message; }
      return { target, message, install };
      `,
    );
    assert.equal(run.status, 0, run.output);
    assert.doesNotMatch(run.result.target, /^memory/);
    assert.match(run.result.message, /DATABASE_URL is not set/);
    assert.match(run.result.install, /for test runs only/);
  });
});
