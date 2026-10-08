#!/usr/bin/env node
/**
 * Replace everything in the PostgreSQL database with a JSON export, without
 * the app.
 *
 *   npm run db:restore -- latest                          the newest backup in storage/backups
 *   npm run db:restore -- lms-20260930-auto.json --force  a database that holds data needs --force
 *   npm run db:restore -- ../downloads/export.json        any JSON export of this app
 *   npm run db:restore -- latest --dry-run                show what would change
 *
 * An empty database (fresh Supabase project after `npm run db:setup`) is
 * filled right away. A database that already holds data is only replaced
 * with --force, and its current contents are first saved as a "safety"
 * backup. Everything is written in one transaction; a running app notices
 * the change and reloads.
 *
 * Older SQLite databases are copied with `npm run db:to-postgres` instead.
 */
import path from "node:path";
import { countDocuments, readBackupData } from "../src/lib/db/data-core.mjs";
import { checkRestorable, resolveBackupSource, writeJsonBackup } from "../src/lib/db/backup-core.mjs";
import { UsageError, backupsTable, confirm, formatNumber, invocationDir, loadConfig, parseArgs, run, table } from "./lib/cli.mjs";
import { assertTables, connect, databaseState, describeDatabaseUrl, readDatabase, replaceDatabase, requireDatabaseUrl, unknownCollections } from "./lib/pg.mjs";

const USAGE = `Usage: npm run db:restore -- <backup> [options]

<backup> is "latest", the name of a backup in the backups folder
(storage/backups, or STORAGE_DIR/backups), or the path of a JSON export.

Everything in the database (DATABASE_URL) is replaced. A database that
already holds data is only replaced with --force; its current data is then
first saved as a "safety" backup, so the restore can itself be undone.

Options:
  --force               Replace a database that already holds data.
  --yes, -y             Do not ask for confirmation.
  --dry-run             Check the backup and show what would change; write nothing.
  --no-safety-backup    Skip the safety backup of the current data.
  --allow-no-admin      Restore even when the backup has no enabled administrator.
  --url <url>           PostgreSQL connection string (default: DATABASE_URL).
  --list                List the existing backups and exit.
  -h, --help            Show this help.

A running app reloads the restored data by itself within a few seconds.
Older SQLite databases are copied with "npm run db:to-postgres" instead.`;

/** Collections whose number of documents changes, largest change first. */
function changes(/** @type {Record<string, number>} */ current, /** @type {Record<string, number>} */ backup) {
  return [...new Set([...Object.keys(current), ...Object.keys(backup)])]
    .map((name) => ({ name, now: current[name] ?? 0, then: backup[name] ?? 0 }))
    .filter((row) => row.now !== row.then)
    .sort((a, b) => Math.abs(b.then - b.now) - Math.abs(a.then - a.now) || a.name.localeCompare(b.name));
}

await run(async () => {
  const { options, positional } = parseArgs(
    process.argv.slice(2),
    { force: "boolean", yes: "boolean", "dry-run": "boolean", "no-safety-backup": "boolean", "allow-no-admin": "boolean", url: "string", list: "boolean", help: "boolean" },
    { y: "yes", h: "help" },
  );
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const config = loadConfig();
  if (options.list) {
    console.log(backupsTable(config.backupsDir).join("\n"));
    return;
  }
  if (positional.length !== 1) throw new UsageError(positional.length ? "Give exactly one backup to restore." : "Which backup should be restored?");
  const url = requireDatabaseUrl(typeof options.url === "string" ? options.url : config.databaseUrl);
  const target = describeDatabaseUrl(url);

  const source = resolveBackupSource(config.backupsDir, positional[0], invocationDir());
  const { data } = readBackupData(source);
  const backup = countDocuments(data);
  const check = checkRestorable(data);
  const skipped = unknownCollections(data);

  const prisma = await connect(url);
  try {
    await assertTables(prisma);
    const current = await databaseState(prisma);

    console.log(`Backup:   ${source} (${formatNumber(backup.records)} records)`);
    console.log(`Database: ${target} (${current.initialized ? `${formatNumber(current.records)} records` : "empty"})`);
    console.log("");
    if (current.initialized) {
      const rows = changes(current.counts, backup.counts);
      if (rows.length) {
        console.log(
          table(
            ["Collection", "Now", "After restore"],
            rows.map((row) => [row.name, formatNumber(row.now), formatNumber(row.then)]),
            [1, 2],
          ).join("\n"),
        );
      } else {
        console.log("Every collection has the same number of records as the backup (their contents may still differ).");
      }
      console.log("");
    }
    for (const warning of check.warnings) console.log(`Note: ${warning}`);
    if (skipped.length) console.log(`Note: this version of the app has no table for ${skipped.join(", ")}; those records are left out.`);
    for (const error of check.errors) console.log(`${options["allow-no-admin"] ? "Warning" : "Problem"}: ${error}`);
    if (check.errors.length && !options["allow-no-admin"]) {
      throw new Error("This backup would leave the site unusable. Nothing was changed. Use --allow-no-admin to restore it anyway.");
    }
    if (current.initialized && !options.force) {
      throw new Error(`The database already holds data (${formatNumber(current.records)} records). Nothing was changed. Use --force to replace it.`);
    }
    if (options["dry-run"]) {
      console.log("Dry run: nothing was changed.");
      return;
    }

    if (current.initialized && !options.yes) {
      if (!process.stdin.isTTY) throw new Error("Refusing to replace the database without confirmation. Run the command again with --yes.");
      if (!(await confirm(`Replace everything in ${target} with this backup?`))) {
        console.log("Cancelled: nothing was changed.");
        return;
      }
    }

    const label = path.basename(source);
    if (current.initialized && !options["no-safety-backup"]) {
      // The file being restored must survive the retention applied to the safety backup.
      const protect = path.dirname(path.resolve(source)) === path.resolve(config.backupsDir) ? [label] : [];
      const safety = writeJsonBackup(config.backupsDir, "safety", await readDatabase(prisma), { reason: `Before restoring ${label}`, createdBy: "db:restore script", protect });
      console.log(`The current data is kept as ${safety.entry.file}`);
    }
    await replaceDatabase(prisma, data, `restore:${label}`);
    console.log(`Restored ${formatNumber(backup.records)} records into ${target}.`);
    console.log("A running app reloads the restored data by itself. Everyone signs in again with the accounts from the backup.");
  } finally {
    await prisma.$disconnect();
  }
}, USAGE);
