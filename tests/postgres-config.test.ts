import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEnvironment, runStartupChecks } from "@/lib/env-check";
import { PostgresDriver } from "@/lib/db/postgres";

/**
 * PostgreSQL is the only database: DATABASE_URL is required in every
 * environment (checked at startup, pointing to ENV-SETUP.md), its shape is
 * checked, settings of the removed SQLite/JSON storage are reported, and
 * the driver explains what is missing instead of connecting.
 */

const BASE = { APP_SECRET: "x".repeat(40), APP_URL: "https://learn.example.com" };
const SUPABASE_POOLED = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1";
const SUPABASE_DIRECT = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

const keys = (issues: { key: string }[]) => issues.map((i) => i.key);

describe("postgres config: startup checks", () => {
  it("requires DATABASE_URL in production and development, pointing to ENV-SETUP.md", () => {
    for (const production of [true, false]) {
      const result = checkEnvironment(BASE, { production });
      const issue = result.errors.find((e) => e.key === "DATABASE_URL");
      assert.ok(issue, `production=${production}`);
      assert.match(issue.message, /ENV-SETUP\.md/);
      assert.match(issue.message, /npm run db:setup/);
    }
  });

  it("rejects a DATABASE_URL that is not a postgresql:// URL", () => {
    const result = checkEnvironment({ ...BASE, DATABASE_URL: "mysql://u:p@host/db", DIRECT_URL: SUPABASE_DIRECT }, { production: true });
    assert.match(result.errors.find((e) => e.key === "DATABASE_URL")?.message ?? "", /postgresql:\/\//);
  });

  it("accepts Supabase's pooled URL with pgbouncer=true and a DIRECT_URL", () => {
    const result = checkEnvironment({ ...BASE, DATABASE_URL: SUPABASE_POOLED, DIRECT_URL: SUPABASE_DIRECT }, { production: true });
    assert.deepEqual(
      [...keys(result.errors), ...keys(result.warnings)].filter((k) => ["DATABASE_URL", "DIRECT_URL", "DB_DRIVER"].includes(k)),
      [],
    );
  });

  it("warns about the transaction pooler without pgbouncer=true, and about a missing DIRECT_URL", () => {
    const result = checkEnvironment({ ...BASE, DATABASE_URL: SUPABASE_POOLED.replace("pgbouncer=true&", "") }, { production: false });
    assert.ok(keys(result.warnings).includes("DATABASE_URL"));
    assert.ok(keys(result.warnings).includes("DIRECT_URL"));
    assert.ok(!keys(result.errors).includes("DATABASE_URL"));
  });

  it("never echoes the password back", () => {
    const result = checkEnvironment({ ...BASE, DATABASE_URL: SUPABASE_POOLED.replace("pgbouncer=true&", "") }, { production: true });
    for (const issue of [...result.errors, ...result.warnings]) assert.doesNotMatch(issue.message, /secret/);
  });

  it("reports the settings of the removed SQLite/JSON storage as unused", () => {
    const result = checkEnvironment({ ...BASE, DATABASE_URL: SUPABASE_POOLED, DIRECT_URL: SUPABASE_DIRECT, DB_DRIVER: "postgres", SQLITE_PATH: "storage/lms.sqlite", DATA_FILE: "storage/db.json" }, { production: false });
    assert.deepEqual(keys(result.warnings).sort(), ["DATA_FILE", "DB_DRIVER", "SQLITE_PATH"]);
    for (const warning of result.warnings) assert.match(warning.message, /no longer used.*db:to-postgres/);
    assert.deepEqual(result.errors, []);
  });
});

describe("postgres config: runStartupChecks", () => {
  const env = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: env.NODE_ENV, NEXT_PHASE: env.NEXT_PHASE, DATABASE_URL: env.DATABASE_URL, APP_SECRET: env.APP_SECRET };
  const originalWarn = console.warn;

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
    console.warn = originalWarn;
  });

  it("stops a development server without DATABASE_URL, with a clear message", () => {
    env.NODE_ENV = "development";
    delete env.NEXT_PHASE;
    delete env.DATABASE_URL;
    console.warn = () => undefined;
    assert.throws(() => runStartupChecks(), (err: Error) => {
      assert.match(err.message, /Refusing to start/);
      assert.match(err.message, /DATABASE_URL is not set/);
      assert.match(err.message, /ENV-SETUP\.md/);
      return true;
    });
  });

  it("does not check anything during next build, so the build needs no database", () => {
    env.NODE_ENV = "production";
    env.NEXT_PHASE = "phase-production-build";
    delete env.DATABASE_URL;
    assert.equal(runStartupChecks(), null);
  });
});

describe("postgres config: the driver without a database", () => {
  it("says what is missing instead of connecting without DATABASE_URL, and hides credentials", async () => {
    const empty = new PostgresDriver({ url: "", collections: ["users"], backupsDir: "unused" });
    await assert.rejects(empty.open(async () => ({ collections: {}, settings: null })), /DATABASE_URL is not set.*ENV-SETUP\.md/);

    const driver = new PostgresDriver({ url: SUPABASE_POOLED, collections: ["users"], backupsDir: "unused", client: unreachableClient() });
    const info = driver.info();
    assert.equal(info.driver, "postgres");
    assert.equal(info.target, "postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
    assert.doesNotMatch(JSON.stringify(info), /secret/);
    assert.equal(driver.asynchronous, true);
    assert.equal(driver.incremental, true);
    const integrity = await driver.checkIntegrity("quick");
    assert.equal(integrity.ok, false);
    assert.match(integrity.messages[0] ?? "", /cannot be reached/);
  });
});

/** A client whose every query fails like an unreachable server (Prisma error P1001). */
function unreachableClient() {
  const fail = async (): Promise<never> => {
    throw Object.assign(new Error("Can't reach database server at `db.example:5432`"), { errorCode: "P1001" });
  };
  return {
    $queryRawUnsafe: fail,
    $executeRawUnsafe: fail,
    $transaction: fail,
    $disconnect: async () => undefined,
  };
}
