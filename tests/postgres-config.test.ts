import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEnvironment } from "@/lib/env-check";
import { parseDatabaseDriver } from "@/lib/server-env";
import { PostgresDriver } from "@/lib/db/postgres";
import { assertNotPostgres } from "../scripts/lib/cli.mjs";

/**
 * Postgres phase 1: configuration. DB_DRIVER=postgres selects the driver,
 * DATABASE_URL is required with it (and checked), and the SQLite-only
 * command-line tools refuse to run against the wrong storage.
 */

const BASE = { APP_SECRET: "x".repeat(40), APP_URL: "https://learn.example.com" };
const SUPABASE_POOLED = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1";
const SUPABASE_DIRECT = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";

const keys = (issues: { key: string }[]) => issues.map((i) => i.key);

describe("postgres config: DB_DRIVER", () => {
  it("accepts postgres and postgresql; anything else falls back to sqlite", () => {
    assert.equal(parseDatabaseDriver("postgres"), "postgres");
    assert.equal(parseDatabaseDriver(" PostgreSQL "), "postgres");
    assert.equal(parseDatabaseDriver("json"), "json");
    assert.equal(parseDatabaseDriver("sqlite"), "sqlite");
    assert.equal(parseDatabaseDriver(""), "sqlite");
    assert.equal(parseDatabaseDriver(undefined), "sqlite");
    assert.equal(parseDatabaseDriver("mysql"), "sqlite");
  });
});

describe("postgres config: startup checks", () => {
  it("requires DATABASE_URL with DB_DRIVER=postgres, in production and development", () => {
    for (const production of [true, false]) {
      const result = checkEnvironment({ ...BASE, DB_DRIVER: "postgres" }, { production });
      assert.ok(keys(result.errors).includes("DATABASE_URL"), `production=${production}`);
    }
  });

  it("rejects a DATABASE_URL that is not a postgresql:// URL", () => {
    const result = checkEnvironment({ ...BASE, DB_DRIVER: "postgres", DATABASE_URL: "mysql://u:p@host/db", DIRECT_URL: SUPABASE_DIRECT }, { production: true });
    assert.match(result.errors.find((e) => e.key === "DATABASE_URL")?.message ?? "", /postgresql:\/\//);
  });

  it("accepts Supabase's pooled URL with pgbouncer=true and a DIRECT_URL", () => {
    const result = checkEnvironment({ ...BASE, DB_DRIVER: "postgres", DATABASE_URL: SUPABASE_POOLED, DIRECT_URL: SUPABASE_DIRECT }, { production: true });
    assert.deepEqual(
      [...keys(result.errors), ...keys(result.warnings)].filter((k) => ["DATABASE_URL", "DIRECT_URL", "DB_DRIVER"].includes(k)),
      [],
    );
  });

  it("warns about the transaction pooler without pgbouncer=true, and about a missing DIRECT_URL", () => {
    const result = checkEnvironment({ ...BASE, DB_DRIVER: "postgres", DATABASE_URL: SUPABASE_POOLED.replace("pgbouncer=true&", "") }, { production: false });
    assert.ok(keys(result.warnings).includes("DATABASE_URL"));
    assert.ok(keys(result.warnings).includes("DIRECT_URL"));
    assert.ok(!keys(result.errors).includes("DATABASE_URL"));
  });

  it("never echoes the password back", () => {
    const result = checkEnvironment({ ...BASE, DB_DRIVER: "postgres", DATABASE_URL: SUPABASE_POOLED.replace("pgbouncer=true&", "") }, { production: true });
    for (const issue of [...result.errors, ...result.warnings]) assert.doesNotMatch(issue.message, /secret/);
  });

  it("leaves SQLite and JSON sites alone, and flags an unknown driver", () => {
    for (const driver of ["", "sqlite", "json"]) {
      const result = checkEnvironment({ ...BASE, DB_DRIVER: driver }, { production: false });
      assert.ok(!keys([...result.errors, ...result.warnings]).includes("DATABASE_URL"), driver);
    }
    const unknown = checkEnvironment({ ...BASE, DB_DRIVER: "mongo" }, { production: false });
    assert.ok(keys(unknown.warnings).includes("DB_DRIVER"));
  });
});

describe("postgres config: tools and driver without a database", () => {
  it("the SQLite backup/restore/export scripts refuse to run with DB_DRIVER=postgres", () => {
    assert.throws(() => assertNotPostgres({ DB_DRIVER: "postgres" }), /data is in PostgreSQL/);
    assert.throws(() => assertNotPostgres({ DB_DRIVER: "postgresql" }), /data is in PostgreSQL/);
    assert.doesNotThrow(() => assertNotPostgres({ DB_DRIVER: "sqlite" }));
    assert.doesNotThrow(() => assertNotPostgres({}));
  });

  it("the driver says what is missing instead of connecting without DATABASE_URL, and hides credentials", async () => {
    const empty = new PostgresDriver({ url: "", collections: ["users"], backupsDir: "unused" });
    await assert.rejects(empty.open(async () => ({ collections: {}, settings: null })), /DATABASE_URL/);

    const driver = new PostgresDriver({ url: SUPABASE_POOLED, collections: ["users"], backupsDir: "unused", client: unreachableClient() });
    const info = driver.info();
    assert.equal(info.driver, "postgres");
    assert.equal(info.file, "postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
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
