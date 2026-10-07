import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { sharedPrismaClient, type PgClient } from "@/lib/db/postgres";

/**
 * Shared by the PostgreSQL integration tests (`tests/postgres-*.test.ts`),
 * which run only when TEST_DATABASE_URL points at a throwaway server:
 *
 *   docker run -d --name ll-pg-test -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
 *   TEST_DATABASE_URL=postgresql://postgres:test@localhost:54329/postgres npm run test:pg
 *
 * Every test database is a temporary schema (`test_<random>`) created from
 * the committed migration SQL and dropped by `dropTestSchemas()`. Never
 * point TEST_DATABASE_URL at a real site's database.
 */

export const TEST_DATABASE_URL = (process.env.TEST_DATABASE_URL ?? "").trim();

/** `false` when the tests can run, else the reason they are skipped. */
export const PG_SKIP: false | string = TEST_DATABASE_URL
  ? false
  : "TEST_DATABASE_URL is not set: the PostgreSQL integration tests are skipped (see tests/helpers/postgres.ts)";

const created: string[] = [];

/** TEST_DATABASE_URL pointed at `schema`. */
export function urlForSchema(schema: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.searchParams.set("schema", schema);
  if (!url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "3");
  return url.toString();
}

/** The committed migrations, as single statements. */
export function migrationStatements(): string[] {
  const root = path.join(process.cwd(), "prisma", "migrations");
  return fs
    .readdirSync(root)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .flatMap((name) => fs.readFileSync(path.join(root, name, "migration.sql"), "utf8").split(/;\s*(?:\r?\n|$)/))
    .map((sql) => sql.replace(/^\s*--.*$/gm, "").trim())
    .filter((sql) => sql && !/^CREATE SCHEMA IF NOT EXISTS "public"$/.test(sql));
}

export function adminClient(): Promise<PgClient> {
  return sharedPrismaClient(TEST_DATABASE_URL);
}

/** A new, empty schema (with the tables unless `migrate` is false); returns its URL. */
export async function createTestSchema(options: { migrate?: boolean } = {}): Promise<string> {
  const schema = `test_${randomBytes(6).toString("hex")}`;
  created.push(schema);
  await (await adminClient()).$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const url = urlForSchema(schema);
  if (options.migrate !== false) {
    const client = await sharedPrismaClient(url);
    for (const sql of migrationStatements()) await client.$executeRawUnsafe(sql);
  }
  return url;
}

/** Drop every schema this process created and close the connections. */
export async function dropTestSchemas(): Promise<void> {
  const admin = await adminClient();
  for (const schema of created.splice(0)) {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await (await sharedPrismaClient(urlForSchema(schema))).$disconnect();
  }
  await admin.$disconnect();
}
