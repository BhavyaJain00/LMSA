#!/usr/bin/env node
/**
 * Export the PostgreSQL database as one JSON document (an array per
 * collection plus `settings`), without the app: the same format as the
 * backups, so `npm run db:restore` and the admin data page restore it.
 * `npm run db:backup` writes the same export into the backups folder; this
 * command is for a file of your choice or standard output.
 *
 *   npm run db:export -- --out export.json
 *   npm run db:export -- --stdout | gzip > export.json.gz
 *   npm run db:export                       into storage/backups (listed on the admin page)
 */
import fs from "node:fs";
import path from "node:path";
import { countDocuments, rawDataToJson } from "../src/lib/db/data-core.mjs";
import { writeJsonBackup } from "../src/lib/db/backup-core.mjs";
import { UsageError, countsTable, formatBytes, formatNumber, fromInvocationDir, loadConfig, parseArgs, run } from "./lib/cli.mjs";
import { connect, readDatabase, requireDatabaseUrl } from "./lib/pg.mjs";

const USAGE = `Usage: npm run db:export -- [options]

Writes every record and the settings of the database (DATABASE_URL) as one
JSON document. Safe to run while the app is running. The file contains
password hashes, sessions and payment records: keep it somewhere safe.

Options:
  --out <file>    Write to this path (must not exist) instead of the backups folder.
  --stdout        Print the JSON to standard output and nothing else.
  --compact       No indentation (smaller file).
  --counts        Also print the number of records per collection.
  --url <url>     PostgreSQL connection string (default: DATABASE_URL).
  -h, --help      Show this help.`;

await run(async () => {
  const { options, positional } = parseArgs(
    process.argv.slice(2),
    { out: "string", stdout: "boolean", compact: "boolean", counts: "boolean", url: "string", help: "boolean" },
    { h: "help" },
  );
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length) throw new UsageError(`Unexpected argument: ${positional[0]}`);
  if (options.stdout && options.out) throw new UsageError("--stdout and --out cannot be combined.");

  const config = loadConfig();
  const url = requireDatabaseUrl(typeof options.url === "string" ? options.url : config.databaseUrl);
  const out = typeof options.out === "string" ? fromInvocationDir(options.out) : undefined;
  if (out && fs.existsSync(out)) throw new Error(`${out} already exists. Choose another name or delete it first.`);
  const pretty = !options.compact;

  const prisma = await connect(url);
  let data;
  try {
    data = await readDatabase(prisma);
  } finally {
    await prisma.$disconnect();
  }

  if (options.stdout) {
    // Not writeSync: a pipe that is momentarily full would fail it. Node drains stdout before exiting.
    process.stdout.write(`${rawDataToJson(data, pretty)}\n`);
    return;
  }

  let file;
  let name = null;
  const { counts, records } = countDocuments(data);
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, rawDataToJson(data, pretty), { encoding: "utf8", flag: "wx" });
    file = out;
  } else {
    const written = writeJsonBackup(config.backupsDir, "manual", data, { reason: "JSON export", createdBy: "db:export script", pretty });
    file = written.entry.file;
    name = written.entry.name;
  }
  console.log(`Exported ${formatNumber(records)} records to ${file} (${formatBytes(fs.statSync(file).size)}).`);
  if (options.counts) console.log(`\n${countsTable(counts).join("\n")}`);
  console.log(`Restore it with: npm run db:restore -- "${name ?? file}" --force`);
}, USAGE);
