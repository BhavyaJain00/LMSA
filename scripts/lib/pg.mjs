/**
 * PostgreSQL access for the database scripts: connect with Prisma (loaded on
 * demand), read everything as RawData from one consistent snapshot, and
 * replace everything in one transaction whose row counts are verified before
 * it commits. The SQL itself lives in `src/lib/db/postgres-core.mjs`, shared
 * with the app.
 */
import {
  bumpWriteSeq,
  countMismatches,
  countRows,
  describeDatabaseUrl,
  expectedCounts,
  isInitialized,
  knownCollections,
  missingTables,
  readAllData,
  writeAllData,
} from "../../src/lib/db/postgres-core.mjs";
import { UsageError } from "./cli.mjs";

/** @typedef {import("../../src/lib/db/data-core.mjs").RawData} RawData */
/**
 * @typedef {object} PgClient
 * @property {(sql: string, ...values: unknown[]) => Promise<unknown>} $queryRawUnsafe
 * @property {(sql: string, ...values: unknown[]) => Promise<number>} $executeRawUnsafe
 * @property {<R>(fn: (tx: PgClient) => Promise<R>, options?: Record<string, unknown>) => Promise<R>} $transaction
 * @property {() => Promise<void>} $disconnect
 */

/** Check a connection string given to a script; returns it trimmed. */
export function requireDatabaseUrl(/** @type {string | undefined} */ url) {
  const value = String(url ?? "").trim();
  if (!value) throw new UsageError('Set DATABASE_URL in .env (or pass --url) to the PostgreSQL database. See ENV-SETUP.md, section 3 "Database".');
  if (!/^postgres(ql)?:\/\//i.test(value)) throw new UsageError("The database must be a postgresql:// connection string.");
  return value;
}

/** A PrismaClient for `url` (disconnect it when done). */
export async function connect(/** @type {string} */ url) {
  let mod;
  try {
    mod = await import("@prisma/client");
  } catch (err) {
    throw new Error(`The Prisma client is missing: run "npm install" (it runs "prisma generate"). ${err instanceof Error ? err.message : String(err)}`);
  }
  const { PrismaClient } = /** @type {{ PrismaClient: new (options: Record<string, unknown>) => PgClient }} */ (/** @type {unknown} */ (mod.default ?? mod));
  return new PrismaClient({ datasourceUrl: url, log: ["warn"] });
}

/** Stop with a clear message when the tables have not been created yet. */
export async function assertTables(/** @type {PgClient} */ db, names = knownCollections()) {
  const missing = await missingTables(db, names);
  if (missing.length) {
    throw new Error(`The database is missing ${missing.length} table(s) (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). Run "npm run db:setup" first.`);
  }
}

/**
 * Everything in the database, read in one consistent snapshot.
 * @param {PgClient} db
 * @returns {Promise<RawData>}
 */
export async function readDatabase(db) {
  const names = knownCollections();
  await assertTables(db, names);
  return db.$transaction(async (tx) => readAllData(tx, names), { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30 * 60_000 });
}

/** Documents per collection in the database, their total, and whether it was ever filled. */
export async function databaseState(/** @type {PgClient} */ db) {
  const names = knownCollections();
  const counts = await countRows(db, names);
  const records = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, records, initialized: records > 0 || (await isInitialized(db)) };
}

/**
 * Replace everything with `data` in one transaction. The row counts are
 * checked before it commits (a mismatch rolls everything back). A running
 * app notices the new `write_seq` and reloads.
 *
 * @param {PgClient} db
 * @param {RawData} data
 * @param {string} source  Recorded in `meta` (e.g. "restore:lms-20261001-auto.json").
 * @returns {Promise<Record<string, number>>} rows per collection after the write
 */
export async function replaceDatabase(db, data, source) {
  const names = knownCollections();
  const expected = expectedCounts(data, names);
  return db.$transaction(
    async (tx) => {
      await bumpWriteSeq(tx);
      await writeAllData(tx, data, names, { source });
      const counts = await countRows(tx, names);
      const wrong = countMismatches(expected, counts);
      // Throwing rolls the whole write back.
      if (wrong.length) throw new Error(`Row counts do not match, nothing was changed: ${wrong.join("; ")}`);
      return counts;
    },
    { maxWait: 15_000, timeout: 30 * 60_000 },
  );
}

/** Collections in `data` that this version of the app has no table for (and that hold documents). */
export function unknownCollections(/** @type {RawData} */ data) {
  const names = knownCollections();
  return Object.keys(data.collections).filter((name) => !names.includes(name) && (data.collections[name]?.length ?? 0) > 0);
}

export { describeDatabaseUrl, expectedCounts, knownCollections };
