#!/usr/bin/env node
/**
 * Back up the PostgreSQL database as a JSON export, without the app (safe
 * while the app is running: everything is read from one consistent
 * snapshot). The backups folder is the one the admin data page lists, so
 * these backups can be restored there too.
 *
 *   npm run db:backup                     manual backup into storage/backups
 *   npm run db:backup -- --auto           today's automatic backup (for cron; keeps the newest 14)
 *   npm run db:backup -- --out copy.json
 *   npm run db:backup -- --list
 *
 * Supabase keeps its own backups of the database as well (daily; point-in-time
 * recovery on paid plans).
 */
import fs from "node:fs";
import path from "node:path";
import { backupFileName, countDocuments, rawDataToJson } from "../src/lib/db/data-core.mjs";
import { getBackupEntry, retentionFor, writeJsonBackup } from "../src/lib/db/backup-core.mjs";
import { UsageError, backupsTable, formatBytes, formatNumber, fromInvocationDir, loadConfig, parseArgs, run } from "./lib/cli.mjs";
import { connect, describeDatabaseUrl, readDatabase, requireDatabaseUrl } from "./lib/pg.mjs";

const USAGE = `Usage: npm run db:backup -- [options]

Writes a JSON export of the whole database (DATABASE_URL) into the backups
folder (storage/backups, or STORAGE_DIR/backups). Safe to run while the app
is running.

Options:
  --auto          Make today's automatic backup. Does nothing when it already
                  exists; older automatic backups beyond the newest ${retentionFor("auto")} are deleted.
                  Use this from cron when the site gets no traffic at night.
  --out <file>    Write the export to this path instead of the backups folder.
  --note <text>   A note stored with the backup and shown on the admin page.
  --url <url>     PostgreSQL connection string (default: DATABASE_URL).
  --list          List the existing backups and exit.
  --json          Print the result as JSON.
  -h, --help      Show this help.`;

await run(async () => {
  const { options, positional } = parseArgs(
    process.argv.slice(2),
    { auto: "boolean", out: "string", note: "string", url: "string", list: "boolean", json: "boolean", help: "boolean" },
    { h: "help" },
  );
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length) throw new UsageError(`Unexpected argument: ${positional[0]}`);
  if (options.auto && options.out) throw new UsageError("--auto and --out cannot be combined.");

  const config = loadConfig();
  if (options.list) {
    console.log(backupsTable(config.backupsDir).join("\n"));
    return;
  }
  const url = requireDatabaseUrl(typeof options.url === "string" ? options.url : config.databaseUrl);
  const out = typeof options.out === "string" ? fromInvocationDir(options.out) : undefined;
  if (out && fs.existsSync(out)) throw new Error(`${out} already exists. Choose another name or delete it first.`);

  const date = new Date();
  if (options.auto) {
    const todays = getBackupEntry(config.backupsDir, backupFileName("auto", date));
    if (todays) {
      if (options.json) console.log(JSON.stringify({ file: todays.file, created: false, records: todays.manifest?.records ?? null }, null, 2));
      else console.log(`Today's automatic backup already exists: ${todays.file}`);
      return;
    }
  }

  const prisma = await connect(url);
  let data;
  try {
    data = await readDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }

  /** @type {{ file: string; created: boolean; records: number; counts: Record<string, number>; pruned: string[]; name: string | null }} */
  let result;
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, rawDataToJson(data), { encoding: "utf8", flag: "wx" });
    result = { file: out, created: true, ...countDocuments(data), pruned: [], name: null };
  } else {
    const note = typeof options.note === "string" ? options.note.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    const written = writeJsonBackup(config.backupsDir, options.auto ? "auto" : "manual", data, {
      date,
      reason: note || (options.auto ? "Daily automatic backup" : undefined),
      createdBy: "db:backup script",
    });
    result = { file: written.entry.file, created: written.created, records: written.records, counts: written.counts, pruned: written.pruned, name: written.entry.name };
  }

  if (options.json) {
    console.log(JSON.stringify({ file: result.file, created: result.created, records: result.records, counts: result.counts, pruned: result.pruned }, null, 2));
    return;
  }
  if (!result.created) {
    console.log(`Today's automatic backup already exists: ${result.file}`);
    return;
  }
  console.log(`Backup written: ${result.file}`);
  console.log(`${formatNumber(result.records)} records, ${formatBytes(fs.statSync(result.file).size)} (from ${describeDatabaseUrl(url)}).`);
  if (result.pruned.length) console.log(`Removed ${result.pruned.length} old automatic backup(s): ${result.pruned.join(", ")}`);
  console.log(`Restore it with: npm run db:restore -- "${result.name ?? result.file}" --force`);
}, USAGE);
