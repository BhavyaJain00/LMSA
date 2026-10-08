#!/usr/bin/env node
/**
 * Copy the data of an older version of the site (a SQLite database or a JSON
 * export) into an empty PostgreSQL database, e.g. Supabase.
 *
 *   npm run db:to-postgres                          storage/lms.sqlite, else storage/db.json* → DATABASE_URL
 *   npm run db:to-postgres -- path/to/lms.sqlite    any SQLite database or .sqlite backup of this app
 *   npm run db:to-postgres -- export.json           a JSON export
 *   npm run db:to-postgres -- --dry-run             check the source and the target; write nothing
 *   npm run db:to-postgres -- --force               replace a database that already holds data
 *
 * Everything is written in one transaction and the row counts per
 * collection are verified before it commits, so a failed copy leaves the
 * target as it was. The source file is only read, never changed or deleted.
 * Run `npm run db:setup` first to create the tables.
 */
import fs from "node:fs";
import path from "node:path";
import { UsageError, confirm, formatNumber, fromInvocationDir, loadConfig, parseArgs, run, table } from "./lib/cli.mjs";
import { assertTables, connect, databaseState, describeDatabaseUrl, expectedCounts, knownCollections, replaceDatabase, requireDatabaseUrl, unknownCollections } from "./lib/pg.mjs";
import { readSourceDatabase } from "./lib/sqlite-source.mjs";

const USAGE = `Usage: npm run db:to-postgres -- [source] [options]

[source] is a SQLite database (or .sqlite backup) or a JSON export made by
this app. Default: storage/lms.sqlite, else storage/db.json, else the newest
storage/db.json.migrated-* file (in STORAGE_DIR).

The target is DATABASE_URL (or --url). Create its tables first with
"npm run db:setup". The source is only read.

Options:
  --url <url>     PostgreSQL connection string (default: DATABASE_URL).
  --force         Replace the target even when it already holds data.
  --yes, -y       Do not ask for confirmation with --force.
  --dry-run       Check the source and the target; write nothing.
  -h, --help      Show this help.`;

/** The old database in the storage folder: lms.sqlite, else db.json, else the newest db.json.migrated-* copy. */
function defaultSource(/** @type {string} */ storageDir) {
  const sqlite = path.join(storageDir, "lms.sqlite");
  if (fs.existsSync(sqlite)) return sqlite;
  const json = path.join(storageDir, "db.json");
  if (fs.existsSync(json)) return json;
  let names = [];
  try {
    names = fs.readdirSync(storageDir).filter((name) => /^db\.json\.migrated-/.test(name));
  } catch {
    // No storage folder.
  }
  const newest = names
    .map((name) => path.join(storageDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  if (newest) return newest;
  throw new UsageError(`No old database found in ${storageDir} (lms.sqlite, db.json or db.json.migrated-*). Give the file to copy.`);
}

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
  const config = loadConfig();
  const source = positional[0] ? fromInvocationDir(positional[0]) : defaultSource(config.storageDir);
  if (!fs.existsSync(source)) throw new UsageError(`${source} does not exist.`);
  const url = requireDatabaseUrl(typeof options.url === "string" ? options.url : config.databaseUrl);
  const target = describeDatabaseUrl(url);

  let read;
  try {
    read = await readSourceDatabase(source);
  } catch (err) {
    throw new Error(`Could not read ${source}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { data, format } = read;
  const names = knownCollections();
  const skipped = unknownCollections(data);
  const expected = expectedCounts(data, names);
  const total = Object.values(expected).reduce((a, b) => a + b, 0);
  console.log(`Source: ${source} (${format === "sqlite" ? "SQLite" : "JSON"}, ${formatNumber(total)} records${data.settings ? ", with settings" : ""})`);
  console.log(`Target: ${target}`);
  if (skipped.length) console.warn(`Skipped (no table in this version): ${skipped.join(", ")}`);

  const prisma = await connect(url);
  try {
    await assertTables(prisma, names);
    const current = await databaseState(prisma);
    if (current.initialized && !options.force) {
      throw new Error(`The target already holds data (${formatNumber(current.records)} records). Nothing was copied. Use --force to replace it.`);
    }
    if (options["dry-run"]) {
      console.log(`Dry run: ${current.initialized ? `would replace ${formatNumber(current.records)} records with` : "would copy"} ${formatNumber(total)} records. Nothing was written.`);
      return;
    }
    if (current.initialized && !options.yes && !(await confirm(`Replace the ${formatNumber(current.records)} records in ${target}?`))) {
      console.log("Cancelled; nothing was changed.");
      return;
    }

    const started = Date.now();
    const stored = await replaceDatabase(prisma, data, `copy:${path.basename(source)}`);
    const rows = names.filter((name) => expected[name] > 0).map((name) => [name, formatNumber(stored[name] ?? 0)]);
    if (rows.length) console.log(table(["Collection", "Records"], rows, [1]).join("\n"));
    console.log(`Copied ${formatNumber(total)} records in ${((Date.now() - started) / 1000).toFixed(1)} s; counts verified. ${source} was not changed.`);
    console.log("Next: start (or restart) the app; it now reads everything from PostgreSQL.");
  } finally {
    await prisma.$disconnect();
  }
}

await run(main, USAGE);
