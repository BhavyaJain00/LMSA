#!/usr/bin/env node
/**
 * Copy the SQLite database (or a JSON export / .sqlite backup) into an
 * empty PostgreSQL database, e.g. Supabase.
 *
 *   npm run db:to-postgres                          SQLITE_PATH (storage/lms.sqlite) → DATABASE_URL
 *   npm run db:to-postgres -- export.json           a JSON export or any .sqlite backup
 *   npm run db:to-postgres -- --dry-run             check the source and the target; write nothing
 *   npm run db:to-postgres -- --force               replace a database that already holds data
 *
 * Everything is written in one transaction and the row counts per
 * collection are verified before it commits, so a failed copy leaves the
 * target as it was. The source file is only read, never changed or deleted.
 * Run `npm run prisma:migrate` first to create the tables.
 */
import path from "node:path";
import { readBackupData } from "../src/lib/db/sqlite-core.mjs";
import {
  bumpWriteSeq,
  countMismatches,
  countRows,
  describeDatabaseUrl,
  expectedCounts,
  isInitialized,
  knownCollections,
  missingTables,
  writeAllData,
} from "../src/lib/db/postgres-core.mjs";
import { UsageError, confirm, formatNumber, fromInvocationDir, loadStorageConfig, parseArgs, run, table } from "./lib/cli.mjs";

const USAGE = `Usage: npm run db:to-postgres -- [source] [options]

[source] is a .sqlite database or backup, or a JSON export. Default: the
SQLite database of this site (SQLITE_PATH, storage/lms.sqlite).

The target is DATABASE_URL (or --url). Create its tables first with
"npm run prisma:migrate". The source is only read.

Options:
  --url <url>     PostgreSQL connection string (default: DATABASE_URL).
  --force         Replace the target even when it already holds data.
  --yes, -y       Do not ask for confirmation with --force.
  --dry-run       Check the source and the target; write nothing.
  -h, --help      Show this help.`;

async function main() {
  const { options, positional } = parseArgs(
    process.argv.slice(2),
    { url: "string", force: "boolean", yes: "boolean", "dry-run": "boolean", help: "boolean" },
    { y: "yes", h: "help" },
  );
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length > 1) throw new UsageError("Give at most one source file.");
  const config = loadStorageConfig({ allowPostgres: true });
  const source = positional[0] ? fromInvocationDir(positional[0]) : config.sqlitePath;
  const url = String(options.url ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) throw new UsageError("Set DATABASE_URL (or pass --url) to the PostgreSQL database to copy into.");
  if (!/^postgres(ql)?:\/\//i.test(url)) throw new UsageError("The target must be a postgresql:// connection string.");
  const target = describeDatabaseUrl(url);

  let data;
  try {
    data = readBackupData(source).data;
  } catch (err) {
    throw new Error(`Could not read ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const names = knownCollections();
  const skipped = Object.keys(data.collections).filter((name) => !names.includes(name) && (data.collections[name]?.length ?? 0) > 0);
  const expected = expectedCounts(data, names);
  const total = Object.values(expected).reduce((a, b) => a + b, 0);
  console.log(`Source: ${source} (${formatNumber(total)} records${data.settings ? ", with settings" : ""})`);
  console.log(`Target: ${target}`);
  if (skipped.length) console.warn(`Skipped (no table in this version): ${skipped.join(", ")}`);

  const { default: prismaPkg } = await import("@prisma/client");
  const prisma = new prismaPkg.PrismaClient({ datasourceUrl: url, log: ["warn"] });
  try {
    const missing = await missingTables(prisma, names);
    if (missing.length) {
      throw new Error(`The target is missing ${missing.length} table(s) (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). Run "npm run prisma:migrate" first.`);
    }
    const current = await countRows(prisma, names);
    const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);
    const holdsData = currentTotal > 0 || (await isInitialized(prisma));
    if (holdsData && !options.force) {
      throw new Error(`The target already holds data (${formatNumber(currentTotal)} records). Nothing was copied. Use --force to replace it.`);
    }
    if (options["dry-run"]) {
      console.log(`Dry run: ${holdsData ? `would replace ${formatNumber(currentTotal)} records with` : "would copy"} ${formatNumber(total)} records. Nothing was written.`);
      return;
    }
    if (holdsData && !options.yes && !(await confirm(`Replace the ${formatNumber(currentTotal)} records in ${target}?`))) {
      console.log("Cancelled; nothing was changed.");
      return;
    }

    const started = Date.now();
    const stored = await prisma.$transaction(
      async (tx) => {
        await bumpWriteSeq(tx);
        await writeAllData(tx, data, names, { source: `copy:${path.basename(source)}` });
        const counts = await countRows(tx, names);
        const wrong = countMismatches(expected, counts);
        // Throwing rolls the whole copy back.
        if (wrong.length) throw new Error(`Row counts do not match, nothing was copied: ${wrong.join("; ")}`);
        return counts;
      },
      { maxWait: 15_000, timeout: 30 * 60_000 },
    );

    const rows = names.filter((name) => expected[name] > 0).map((name) => [name, formatNumber(stored[name] ?? 0)]);
    if (rows.length) console.log(table(["Collection", "Records"], rows, [1]).join("\n"));
    console.log(`Copied ${formatNumber(total)} records in ${((Date.now() - started) / 1000).toFixed(1)} s; counts verified. ${source} was not changed.`);
    console.log("Next: set DB_DRIVER=postgres (and DATABASE_URL) in .env and restart the app.");
  } finally {
    await prisma.$disconnect();
  }
}

await run(main, USAGE);
