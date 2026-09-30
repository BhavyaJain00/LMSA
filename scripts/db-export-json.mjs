#!/usr/bin/env node
/**
 * Export the database as one JSON document (the db.json format: an array
 * per collection plus `settings`), without the app. The export can be
 * restored with `npm run db:restore` or from the admin data page, and is the
 * way back to DB_DRIVER=json.
 *
 *   npm run db:export                       into storage/backups (listed on the admin page)
 *   npm run db:export -- --out export.json
 *   npm run db:export -- --stdout | gzip > export.json.gz
 */
import fs from "node:fs";
import { rawDataToJson } from "../src/lib/db/sqlite-core.mjs";
import { exportJsonOffline, readLiveData } from "../src/lib/db/backup-core.mjs";
import { UsageError, countsTable, formatBytes, formatNumber, fromInvocationDir, loadStorageConfig, parseArgs, run } from "./lib/cli.mjs";

const USAGE = `Usage: npm run db:export -- [options]

Writes every record and the settings as one JSON document. Safe to run while
the app is running. The file contains password hashes, sessions and payment
records: keep it somewhere safe.

Options:
  --out <file>    Write to this path (must not exist) instead of the backups folder.
  --stdout        Print the JSON to standard output and nothing else.
  --compact       No indentation (smaller file).
  --counts        Also print the number of records per collection.
  -h, --help      Show this help.`;

await run(() => {
  const { options, positional } = parseArgs(process.argv.slice(2), { out: "string", stdout: "boolean", compact: "boolean", counts: "boolean", help: "boolean" }, { h: "help" });
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (positional.length) throw new UsageError(`Unexpected argument: ${positional[0]}`);
  if (options.stdout && options.out) throw new UsageError("--stdout and --out cannot be combined.");

  const config = loadStorageConfig();
  const pretty = !options.compact;
  if (options.stdout) {
    // Not writeSync: a pipe that is momentarily full would fail it. Node drains stdout before exiting.
    process.stdout.write(`${rawDataToJson(readLiveData(config), pretty)}\n`);
    return;
  }

  const out = typeof options.out === "string" ? fromInvocationDir(options.out) : undefined;
  if (out && fs.existsSync(out)) throw new Error(`${out} already exists. Choose another name or delete it first.`);
  const result = exportJsonOffline(config, { out, pretty });
  console.log(`Exported ${formatNumber(result.records)} records to ${result.file} (${formatBytes(fs.statSync(result.file).size)}).`);
  if (options.counts) console.log(`\n${countsTable(result.counts).join("\n")}`);
  console.log(`Restore it with: npm run db:restore -- "${result.entry ? result.entry.name : result.file}"`);
}, USAGE);
