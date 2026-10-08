/**
 * Shared by the database scripts (`db-backup.mjs`, `db-restore.mjs`,
 * `db-export-json.mjs`, `db-copy-to-postgres.mjs`): argument parsing, the
 * same configuration the app reads (`.env`: DATABASE_URL, STORAGE_DIR) and
 * plain-text output. Node built-ins only.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { backupsDirIn, listBackupFiles } from "../../src/lib/db/data-core.mjs";

/** The project root (the folder holding package.json), whatever the current directory is. */
export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A problem with how the script was called: printed without a stack trace, exit code 2. */
export class UsageError extends Error {}

/**
 * Parse command-line arguments.
 *
 * `spec` maps option names to "boolean" or "string"; `aliases` maps short
 * flags to option names. Supports `--name value`, `--name=value` and `--`
 * (everything after it is positional).
 *
 * @param {string[]} argv
 * @param {Record<string, "boolean" | "string">} spec
 * @param {Record<string, string>} [aliases]
 * @returns {{ options: Record<string, string | boolean | undefined>; positional: string[] }}
 */
export function parseArgs(argv, spec, aliases = {}) {
  /** @type {Record<string, string | boolean | undefined>} */
  const options = {};
  /** @type {string[]} */
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      positional.push(arg);
      continue;
    }
    let name = arg;
    /** @type {string | undefined} */
    let inline;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) inline = arg.slice(eq + 1);
    } else {
      name = aliases[arg.slice(1)] ?? "";
    }
    const type = spec[name];
    if (!type) throw new UsageError(`Unknown option: ${arg}`);
    if (type === "boolean") {
      if (inline !== undefined) throw new UsageError(`--${name} does not take a value.`);
      options[name] = true;
      continue;
    }
    const value = inline ?? argv[++i];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) throw new UsageError(`--${name} needs a value.`);
    options[name] = value;
  }
  return { options, positional };
}

/**
 * Read `.env.local` and `.env` from the project root the way the app does
 * (variables already set in the environment win), then resolve the
 * database and the backups folder.
 *
 * @returns {{ databaseUrl: string; storageDir: string; backupsDir: string }}
 */
export function loadConfig() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(PROJECT_ROOT, name);
    if (!fs.existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch (err) {
      throw new Error(`Could not read ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return resolveConfig(process.env, PROJECT_ROOT);
}

/**
 * Where the data lives, from the variables the app reads (DATABASE_URL,
 * STORAGE_DIR), with relative paths resolved against `cwd`.
 *
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 */
export function resolveConfig(env, cwd) {
  const storageDir = path.resolve(cwd, (env.STORAGE_DIR ?? "").trim() || "storage");
  return { databaseUrl: (env.DATABASE_URL ?? "").trim(), storageDir, backupsDir: backupsDirIn(storageDir) };
}

/** A path given on the command line, relative to where the command was run. */
export function fromInvocationDir(/** @type {string} */ file) {
  // `npm run` changes the working directory to the project root and keeps the original in INIT_CWD.
  return path.resolve(process.env.INIT_CWD || process.cwd(), file);
}

/** The folder command-line paths are relative to. */
export function invocationDir() {
  return process.env.INIT_CWD || process.cwd();
}

export function formatBytes(/** @type {number} */ bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatNumber(/** @type {number} */ n) {
  return new Intl.NumberFormat("en-US").format(n);
}

/** "2026-09-30 17:18" in local time. */
export function formatWhen(/** @type {string} */ iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Lines of an aligned text table.
 * @param {string[]} headers
 * @param {string[][]} rows
 * @param {number[]} [rightAligned]  Indexes of right-aligned columns.
 */
export function table(headers, rows, rightAligned = []) {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map((row) => row[column].length)));
  const line = (/** @type {string[]} */ cells) =>
    cells
      .map((cell, column) => (rightAligned.includes(column) ? cell.padStart(widths[column]) : cell.padEnd(widths[column])))
      .join("  ")
      .trimEnd();
  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
}

/** The backups folder as a text table (newest first). */
export function backupsTable(/** @type {string} */ dir) {
  const backups = listBackupFiles(dir);
  if (!backups.length) return [`No backups in ${dir} yet.`];
  return [
    `Backups in ${dir}:`,
    "",
    ...table(
      ["Name", "Kind", "Size", "Records", "Created"],
      backups.map((b) => [b.name, b.kind, formatBytes(b.sizeBytes), b.manifest ? formatNumber(b.manifest.records) : "?", formatWhen(b.createdAt)]),
      [2, 3],
    ),
  ];
}

/** Per-collection document counts as a text table (empty collections left out). */
export function countsTable(/** @type {Record<string, number>} */ counts) {
  const rows = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => [name, formatNumber(n)]);
  return rows.length ? table(["Collection", "Records"], rows, [1]) : ["(no records)"];
}

/** Ask a yes/no question on the terminal. Without a terminal the answer is no. */
export async function confirm(/** @type {string} */ question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Run a script's main function: usage problems exit with 2 and the help
 * text, every other failure with 1 and its message (no stack trace, unless
 * DEBUG is set).
 *
 * @param {() => Promise<void> | void} main
 * @param {string} usage
 */
export async function run(main, usage) {
  try {
    await main();
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${usage}`);
      process.exitCode = 2;
      return;
    }
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    if (process.env.DEBUG && err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}
