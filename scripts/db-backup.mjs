#!/usr/bin/env node
/**
 * Back up the database without the app (safe while the app is running:
 * SQLite's `VACUUM INTO` takes a consistent snapshot).
 *
 *   npm run db:backup                     manual backup into storage/backups
 *   npm run db:backup -- --auto           today's automatic backup (for cron; keeps the newest 14)
 *   npm run db:backup -- --out copy.sqlite
 *   npm run db:backup -- --list
 */
import fs from "node:fs";
import { backupOffline, retentionFor } from "../src/lib/db/backup-core.mjs";
import { UsageError, backupsTable, formatBytes, formatNumber, fromInvocationDir, loadStorageConfig, parseArgs, run } from "./lib/cli.mjs";

const USAGE = `Usage: npm run db:backup -- [options]

Writes a snapshot of the database into the backups folder (storage/backups).
Safe to run while the app is running.

Options:
  --auto          Make today's automatic backup. Does nothing when it already
                  exists; older automatic backups beyond the newest ${retentionFor("auto")} are deleted.
                  Use this from cron when the site gets no traffic at night.
  --out <file>    Write the snapshot to this path instead of the backups folder.
  --note <text>   A note stored with the backup and shown on the admin page.
  --list          List the existing backups and exit.
  --json          Print the result as JSON.
  -h, --help      Show this help.`;

await run(() => {
  const { options, positional } = parseArgs(process.argv.slice(2), { auto: "boolean", out: "string", note: "string", list: "boolean", json: "boolean", help: "boolean" }, { h: "help" });
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length) throw new UsageError(`Unexpected argument: ${positional[0]}`);
  if (options.auto && options.out) throw new UsageError("--auto and --out cannot be combined.");

  const config = loadStorageConfig();
  if (options.list) {
    console.log(backupsTable(config.backupsDir).join("\n"));
    return;
  }

  const note = typeof options.note === "string" ? options.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const result = backupOffline(config, {
    kind: options.auto ? "auto" : "manual",
    out: typeof options.out === "string" ? fromInvocationDir(options.out) : undefined,
    reason: note || (options.auto ? "Daily automatic backup" : undefined),
    createdBy: "db:backup script",
  });

  if (options.json) {
    console.log(JSON.stringify({ file: result.file, created: result.created, records: result.records, counts: result.counts, pruned: result.pruned }, null, 2));
    return;
  }
  if (!result.created) {
    console.log(`Today's automatic backup already exists: ${result.file}`);
    return;
  }
  const size = formatBytes(fs.statSync(result.file).size);
  console.log(`Backup written: ${result.file}`);
  console.log(`${formatNumber(result.records)} records, ${size} (${config.driver === "sqlite" ? "SQLite" : "JSON"} database at ${config.driver === "sqlite" ? config.sqlitePath : config.dataFile}).`);
  if (result.pruned.length) console.log(`Removed ${result.pruned.length} old automatic backup(s): ${result.pruned.join(", ")}`);
  console.log(`Restore it with: npm run db:restore -- "${result.entry ? result.entry.name : result.file}"`);
}, USAGE);
