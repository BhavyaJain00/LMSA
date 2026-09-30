#!/usr/bin/env node
/**
 * Replace the database with the contents of a backup, without the app.
 *
 *   npm run db:restore -- latest
 *   npm run db:restore -- lms-20260930-auto.sqlite        a backup in storage/backups
 *   npm run db:restore -- ../downloads/export.json        any .sqlite backup or JSON export
 *   npm run db:restore -- latest --dry-run                show what would change
 *
 * The current data is first copied to a "safety" backup. A damaged SQLite
 * file is moved aside (never deleted) and rebuilt from the backup.
 */
import path from "node:path";
import { countDocuments, readBackupData } from "../src/lib/db/sqlite-core.mjs";
import { checkRestorable, probeDatabase, readLiveData, resolveBackupSource, restoreOffline } from "../src/lib/db/backup-core.mjs";
import { UsageError, backupsTable, confirm, formatNumber, invocationDir, loadStorageConfig, parseArgs, run, table } from "./lib/cli.mjs";

const USAGE = `Usage: npm run db:restore -- <backup> [options]

<backup> is "latest", the name of a backup in the backups folder
(storage/backups), or the path of a .sqlite backup or JSON export.

Everything in the database is replaced. The current data is first saved as a
"safety" backup, so a restore can itself be undone.

Options:
  --yes, -y             Do not ask for confirmation.
  --dry-run             Check the backup and show what would change; write nothing.
  --no-safety-backup    Skip the safety backup of the current data.
  --force               Restore even when the backup has no enabled administrator.
  --list                List the existing backups and exit.
  -h, --help            Show this help.

Stop the app first when you can. A running app picks up the restored SQLite
data by itself within a second or two; with DB_DRIVER=json it must be restarted.`;

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
    { yes: "boolean", "dry-run": "boolean", "no-safety-backup": "boolean", force: "boolean", list: "boolean", help: "boolean" },
    { y: "yes", h: "help" },
  );
  if (options.help) {
    console.log(USAGE);
    return;
  }
  const config = loadStorageConfig();
  if (options.list) {
    console.log(backupsTable(config.backupsDir).join("\n"));
    return;
  }
  if (positional.length !== 1) throw new UsageError(positional.length ? "Give exactly one backup to restore." : "Which backup should be restored?");

  const source = resolveBackupSource(config.backupsDir, positional[0], invocationDir());
  const target = config.driver === "sqlite" ? config.sqlitePath : config.dataFile;
  const { format, data } = readBackupData(source);
  const backup = countDocuments(data);
  const check = checkRestorable(data);

  /** @type {Record<string, number> | null} */
  let current = null;
  let state = "missing";
  if (config.driver === "sqlite") state = probeDatabase(target).state;
  if (config.driver === "json" || state === "healthy") {
    try {
      current = countDocuments(readLiveData(config)).counts;
      state = "healthy";
    } catch {
      // No readable database yet: nothing to compare with.
    }
  }

  console.log(`Backup:   ${source} (${format === "sqlite" ? "SQLite" : "JSON"}, ${formatNumber(backup.records)} records)`);
  console.log(`Database: ${target} (${state === "healthy" ? `${formatNumber(Object.values(current ?? {}).reduce((a, b) => a + b, 0))} records` : state === "damaged" ? "damaged, will be moved aside" : "does not exist yet"})`);
  console.log("");
  if (current) {
    const rows = changes(current, backup.counts);
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
  for (const error of check.errors) console.log(`${options.force ? "Warning" : "Problem"}: ${error}`);
  if (check.errors.length && !options.force) {
    throw new Error("This backup would leave the site unusable. Nothing was changed. Use --force to restore it anyway.");
  }
  if (options["dry-run"]) {
    console.log("Dry run: nothing was changed.");
    return;
  }

  if (!options.yes) {
    if (!process.stdin.isTTY) throw new Error("Refusing to replace the database without confirmation. Run the command again with --yes.");
    if (!(await confirm(`Replace everything in ${path.basename(target)} with this backup?`))) {
      console.log("Cancelled: nothing was changed.");
      return;
    }
  }

  const result = restoreOffline(config, source, { safetyBackup: !options["no-safety-backup"], force: options.force === true });
  console.log(`Restored ${formatNumber(result.records)} records into ${target}.`);
  if (result.safety) console.log(`The previous data is kept as ${result.safety.file}`);
  for (const file of result.movedAside) console.log(`The damaged file was kept as ${file}`);
  if (result.mode === "json") console.log("Restart the app now: a running app still holds the old data in memory and would write it back.");
  else if (result.mode === "transaction") console.log("A running app reloads the restored data by itself. Everyone signs in again with the accounts from the backup.");
  else console.log("Start the app again.");
}, USAGE);
