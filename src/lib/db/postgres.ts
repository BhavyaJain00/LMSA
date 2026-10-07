import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { rawDataToJson, readBackupData, readJsonFile, type ChangeSet, type RawData } from "./sqlite-core.mjs";
import * as pg from "./postgres-core.mjs";
import type { OpenOrigin, OpenResult, StorageInfo, StoreDriver } from "./driver";

/**
 * PostgreSQL storage (Supabase or any PostgreSQL 13+) through Prisma,
 * selected with DB_DRIVER=postgres.
 *
 * Phase 1 keeps the store's in-memory model: `open()` loads every table,
 * `persist()` writes the change sets the engine computes, in one
 * transaction each. The SQL lives in `postgres-core.mjs`; the tables come
 * from `prisma/schema.prisma` (`npm run prisma:migrate`).
 *
 * Every call reaches the database over the network, so the driver is
 * `asynchronous`: the engine awaits it and runs writes, reload checks and
 * the last write on shutdown through its queue.
 *
 * `@prisma/client` is loaded on first use (a dynamic import), so SQLite
 * sites never load it and `next build` does not need DATABASE_URL.
 */

/** The subset of a PrismaClient (or interactive-transaction client) the driver uses. */
export interface PgExecutor {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}

export interface PgClient extends PgExecutor {
  $transaction<R>(fn: (tx: PgExecutor) => Promise<R>, options?: { maxWait?: number; timeout?: number; isolationLevel?: "ReadCommitted" | "RepeatableRead" | "Serializable" }): Promise<R>;
  $disconnect(): Promise<void>;
}

export interface PostgresDriverOptions {
  /** DATABASE_URL (Supabase: the pooled connection, port 6543, `?pgbouncer=true&connection_limit=…`). */
  url: string;
  collections: readonly string[];
  /** Folder for JSON backups (pg_dump is not available; Supabase keeps its own backups too). */
  backupsDir: string;
  /** SQLite database imported when PostgreSQL is empty (SQLITE_PATH). */
  sqliteFile?: string;
  /** Legacy JSON database imported when PostgreSQL is empty and there is no SQLite file (DATA_FILE). */
  legacyJsonFile?: string;
  /** A client to use instead of the shared PrismaClient (tests). */
  client?: PgClient;
  /** Longest a write transaction may run (default 60 s); bulk replaces get 15 minutes. */
  transactionTimeoutMs?: number;
}

const BULK_TIMEOUT_MS = 15 * 60_000;
const MAX_WAIT_MS = 15_000;
const INFO_REFRESH_MS = 60_000;

const g = globalThis as unknown as { __llPrisma?: Map<string, Promise<PgClient>> };

/**
 * The PrismaClient for `url`, created once per process and kept on
 * `globalThis` so development hot reloads do not open new connection pools.
 * A client that was disconnected reconnects by itself on its next query.
 */
export function sharedPrismaClient(url: string): Promise<PgClient> {
  const clients = (g.__llPrisma ??= new Map());
  let client = clients.get(url);
  if (!client) {
    client = createPrismaClient(url);
    clients.set(url, client);
    client.catch(() => clients.delete(url));
  }
  return client;
}

async function createPrismaClient(url: string): Promise<PgClient> {
  let mod: typeof import("@prisma/client");
  try {
    mod = await import("@prisma/client");
  } catch (err) {
    throw new Error(`DB_DRIVER=postgres needs the Prisma client: run "npm install" (it runs "prisma generate"). ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return new mod.PrismaClient({ datasourceUrl: url, log: ["warn"] }) as unknown as PgClient;
  } catch (err) {
    throw new Error(`Could not create the Prisma client (run "npm run prisma:generate"): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Turn Prisma's connection errors into a message that says what to check. */
function explain(err: unknown, target: string, action: string): Error {
  const code = (err as { errorCode?: string; code?: string } | null)?.errorCode ?? (err as { code?: string } | null)?.code;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "P1001" || code === "P1002" || /can't reach database server|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(message)) {
    return new Error(`Could not ${action}: the PostgreSQL server at ${target} cannot be reached. Check DATABASE_URL and that the database is running.`);
  }
  if (code === "P1000" || /authentication failed/i.test(message)) {
    return new Error(`Could not ${action}: PostgreSQL refused the credentials in DATABASE_URL (${target}).`);
  }
  return err instanceof Error ? err : new Error(message);
}

export class PostgresDriver implements StoreDriver {
  readonly kind = "postgres" as const;
  readonly incremental = true;
  readonly asynchronous = true;
  readonly backupsDir: string;
  private readonly collections: string[];
  private readonly target: string;
  private clientPromise: Promise<PgClient> | null = null;
  /** `meta.write_seq` after this process's last read or write. */
  private seq = 0;
  /** A write found that another process had written since our last read. */
  private external = false;
  private lastWriteAt: string | null = null;
  private infoCache: { sizeBytes: number | null; meta: Record<string, string>; schemaVersion: number | null; serverVersion: string | null; at: number } | null = null;
  private infoRefresh: Promise<void> | null = null;

  constructor(private readonly options: PostgresDriverOptions) {
    this.backupsDir = options.backupsDir;
    this.collections = [...options.collections];
    this.target = pg.describeDatabaseUrl(options.url);
  }

  private client(): Promise<PgClient> {
    if (this.options.client) return Promise.resolve(this.options.client);
    if (!this.options.url) return Promise.reject(new Error("DB_DRIVER=postgres needs DATABASE_URL (see .env.example)."));
    return (this.clientPromise ??= sharedPrismaClient(this.options.url));
  }

  private async transaction<R>(fn: (tx: PgExecutor) => Promise<R>, timeout = this.options.transactionTimeoutMs ?? 60_000): Promise<R> {
    const client = await this.client();
    return client.$transaction(fn, { maxWait: MAX_WAIT_MS, timeout });
  }

  /**
   * Check the schema, then read everything. An empty database is filled
   * first, in one transaction: from the SQLite database (SQLITE_PATH) when
   * there is one, else from the legacy JSON file (renamed to
   * `<name>.migrated-<timestamp>` afterwards, never deleted), else from
   * `initialData()` (demo seed or bootstrap admin).
   */
  async open(initialData: () => Promise<RawData>): Promise<OpenResult> {
    try {
      const client = await this.client();
      const missing = await pg.missingTables(client, this.collections);
      if (missing.length) {
        throw new Error(
          `The PostgreSQL database ${this.target} is missing ${missing.length} table(s) (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}). ` +
            'Run "npm run prisma:migrate" (DATABASE_URL and DIRECT_URL must be set), then start the app again.',
        );
      }
      if (await pg.isInitialized(client)) {
        const data = await this.readEverything();
        this.warnAboutNewerSqlite();
        void this.refreshInfo();
        return { data, origin: "existing" };
      }

      const source = this.readImportSource();
      let origin: OpenOrigin = "seeded";
      if (source) {
        const result = await this.initializeWith(source.data, source.label);
        if (result.written) {
          origin = source.kind === "sqlite" ? "imported-sqlite" : "imported-json";
          this.reportImport(source.data, source.label, result.duplicates, result.skipped);
          if (source.kind === "json" && source.file) await this.archiveLegacyFile(source.file);
        } else {
          origin = "existing";
        }
      } else {
        const result = await this.initializeWith(await initialData(), "seed");
        if (!result.written) origin = "existing";
      }
      const data = await this.readEverything();
      void this.refreshInfo();
      return { data, origin };
    } catch (err) {
      throw explain(err, this.target, "open the database");
    }
  }

  async persist(_data: RawData, changes: ChangeSet | null): Promise<void> {
    if (!changes || (!changes.collections.length && changes.settings === null)) return;
    const now = new Date().toISOString();
    const seq = await this.transaction(async (tx) => {
      const next = await pg.bumpWriteSeq(tx);
      await pg.applyChangeSet(tx, changes, now);
      return next;
    });
    if (seq !== this.seq + 1) this.external = true;
    this.seq = seq;
    this.lastWriteAt = now;
  }

  async replaceAll(data: RawData, source: string): Promise<void> {
    const now = new Date().toISOString();
    const seq = await this.transaction(async (tx) => {
      const next = await pg.bumpWriteSeq(tx);
      await pg.writeAllData(tx, data, this.collections, { source, now });
      return next;
    }, BULK_TIMEOUT_MS);
    this.seq = seq;
    this.external = false;
    this.lastWriteAt = now;
    void this.refreshInfo();
  }

  async hasExternalChanges(): Promise<boolean> {
    if (this.external) return true;
    return (await pg.readWriteSeq(await this.client())) !== this.seq;
  }

  async reload(): Promise<RawData> {
    const data = await this.readEverything();
    this.external = false;
    return data;
  }

  /** A JSON export of `data` (the in-memory state, settled by the caller): pg_dump is not available here. */
  async backupTo(target: string, data: RawData): Promise<void> {
    await fsp.mkdir(path.dirname(/* turbopackIgnore: true */ target), { recursive: true });
    await fsp.writeFile(/* turbopackIgnore: true */ target, rawDataToJson(data), { encoding: "utf8", flag: "wx" });
  }

  addCollections(names: readonly string[]): void {
    const known = new Set(pg.knownCollections());
    for (const name of names) {
      if (this.collections.includes(name)) continue;
      if (!known.has(name)) {
        console.warn(`[db] the collection "${name}" has no PostgreSQL table yet: run "npm run prisma:schema" and "npm run prisma:migrate", then restart.`);
        continue;
      }
      this.collections.push(name);
    }
  }

  /**
   * Quick: the server answers, every table exists, row counts are readable.
   * Full: also that every row's id and extracted columns match its document.
   */
  async checkIntegrity(mode: "quick" | "full"): Promise<{ ok: boolean; messages: string[] }> {
    const messages: string[] = [];
    try {
      const client = await this.client();
      await client.$queryRawUnsafe("SELECT 1");
      const missing = await pg.missingTables(client, this.collections);
      if (missing.length) messages.push(`Missing tables: ${missing.join(", ")}. Run "npm run prisma:migrate".`);
      const present = this.collections.filter((name) => !missing.includes(pg.tableFor(name).table));
      await pg.countRows(client, present);
      if (mode === "full") {
        for (const name of present) {
          const spec = pg.tableFor(name);
          const checks = [`"id" IS DISTINCT FROM "doc"->>'id'`, ...spec.columns.map((c) => `${pg.quoteIdent(c.column)} IS DISTINCT FROM "doc"->>'${c.key}'`)];
          const rows = (await client.$queryRawUnsafe(`SELECT count(*)::int AS "n" FROM ${pg.quoteIdent(spec.table)} WHERE ${checks.join(" OR ")}`)) as { n: number }[];
          const bad = Number(rows[0]?.n ?? 0);
          if (bad) messages.push(`${name}: ${bad} row(s) whose id or indexed columns do not match the document.`);
        }
      }
      void this.refreshInfo(true);
    } catch (err) {
      messages.push(explain(err, this.target, "check the database").message);
    }
    return messages.length ? { ok: false, messages } : { ok: true, messages: ["ok"] };
  }

  async ping(): Promise<void> {
    const client = await this.client();
    await client.$queryRawUnsafe("SELECT 1");
  }

  info(): StorageInfo {
    const cache = this.infoCache;
    if (!cache || Date.now() - cache.at > INFO_REFRESH_MS) void this.refreshInfo();
    const meta = cache?.meta ?? {};
    return {
      driver: "postgres",
      file: this.target,
      sizeBytes: cache?.sizeBytes ?? null,
      walBytes: null,
      modifiedAt: this.lastWriteAt ?? meta.last_replaced_at ?? meta.initialized_at ?? null,
      sqliteVersion: null,
      schemaVersion: cache?.schemaVersion ?? null,
      meta,
      serverVersion: cache?.serverVersion ?? null,
    };
  }

  async close(): Promise<void> {
    if (this.options.client || !this.clientPromise) return;
    const client = await this.clientPromise.catch(() => null);
    await client?.$disconnect();
  }

  /** Meta, size and versions for `info()` (cached; refreshed in the background). */
  refreshInfo(wait = false): Promise<void> {
    if (this.infoRefresh && !wait) return this.infoRefresh;
    const run = (async () => {
      try {
        const client = await this.client();
        const meta = await pg.readMeta(client);
        const sizeRows = (await client.$queryRawUnsafe(
          `SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS "size" FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind = 'r'`,
        )) as { size: bigint | number }[];
        const versionRows = (await client.$queryRawUnsafe("SELECT current_setting('server_version') AS \"v\"")) as { v: string }[];
        // Applied migrations; tables created without `prisma migrate` have no history (looked up first, so no query fails).
        let schemaVersion: number | null = null;
        const history = (await client.$queryRawUnsafe(`SELECT to_regclass('_prisma_migrations') IS NOT NULL AS "found"`)) as { found: boolean }[];
        if (history[0]?.found) {
          const rows = (await client.$queryRawUnsafe(
            `SELECT count(*)::int AS "n" FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
          )) as { n: number }[];
          schemaVersion = Number(rows[0]?.n ?? 0) || null;
        }
        this.infoCache = {
          meta,
          sizeBytes: Number(sizeRows[0]?.size ?? 0),
          serverVersion: versionRows[0]?.v ? `PostgreSQL ${String(versionRows[0].v).split(" ")[0]}` : null,
          schemaVersion,
          at: Date.now(),
        };
      } catch {
        // Shown as unknown; the health check and the integrity check report connection problems.
      } finally {
        this.infoRefresh = null;
      }
    })();
    this.infoRefresh = run;
    return run;
  }

  /** Everything, from one consistent snapshot, with the `write_seq` it belongs to. */
  private async readEverything(): Promise<RawData> {
    const { seq, data } = await (await this.client()).$transaction(
      async (tx) => ({ seq: await pg.readWriteSeq(tx), data: await pg.readAllData(tx, this.collections) }),
      { isolationLevel: "RepeatableRead", maxWait: MAX_WAIT_MS, timeout: BULK_TIMEOUT_MS },
    );
    this.seq = seq;
    return data;
  }

  /** Store the first contents. `written` is false when another process initialized the database first. */
  private async initializeWith(data: RawData, source: string) {
    const now = new Date().toISOString();
    return this.transaction(async (tx) => {
      await pg.bumpWriteSeq(tx);
      return pg.writeAllData(tx, data, this.collections, { source, initialize: true, now });
    }, BULK_TIMEOUT_MS);
  }

  /** What an empty database is filled from: the SQLite database, else the legacy JSON file. */
  private readImportSource(): { kind: "sqlite" | "json"; data: RawData; label: string; file: string | null } | null {
    const sqlite = this.options.sqliteFile;
    if (sqlite && fs.existsSync(/* turbopackIgnore: true */ sqlite)) {
      try {
        return { kind: "sqlite", data: readBackupData(sqlite).data, label: `sqlite:${path.basename(sqlite)}`, file: sqlite };
      } catch (err) {
        throw new Error(
          `Could not import ${sqlite} into PostgreSQL: ${err instanceof Error ? err.message : String(err)}. Fix or move the file, or set DB_DRIVER=sqlite to keep using it.`,
        );
      }
    }
    const json = this.options.legacyJsonFile;
    if (json && fs.existsSync(/* turbopackIgnore: true */ json)) {
      try {
        return { kind: "json", data: readJsonFile(json), label: `json:${path.basename(json)}`, file: json };
      } catch (err) {
        throw new Error(`Could not import ${json} into PostgreSQL: ${err instanceof Error ? err.message : String(err)}. Fix or move the file, or set DB_DRIVER=json to keep using it.`);
      }
    }
    return null;
  }

  private reportImport(source: RawData, label: string, duplicates: Record<string, number>, skipped: string[]): void {
    let documents = 0;
    for (const [name, docs] of Object.entries(source.collections)) {
      if (!this.collections.includes(name)) continue;
      documents += docs.length - (duplicates[name] ?? 0);
    }
    console.info(`[db] imported ${documents} document(s) from ${label} into PostgreSQL (${this.target}).`);
    const dropped = Object.entries(duplicates).map(([name, n]) => `${name} (${n})`);
    if (dropped.length) {
      console.warn(`[db] the import skipped documents whose id was already used by an earlier document in the same collection: ${dropped.join(", ")}.`);
    }
    if (skipped.length) console.warn(`[db] the import skipped collections this version of the app does not know: ${skipped.join(", ")}.`);
  }

  /** Rename the imported JSON file so it is not imported again (never deleted); the new name goes into `meta`. */
  private async archiveLegacyFile(file: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    let target = `${file}.migrated-${stamp}`;
    for (let n = 2; fs.existsSync(/* turbopackIgnore: true */ target); n++) target = `${file}.migrated-${stamp}-${n}`;
    try {
      fs.renameSync(/* turbopackIgnore: true */ file, target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      console.warn(`[db] ${file} was imported but could not be renamed (${(err as Error).message}). It is ignored from now on because PostgreSQL holds the data; rename or move it yourself.`);
      return;
    }
    console.info(`[db] the JSON file was kept as ${target}.`);
    await this.transaction(async (tx) => {
      await pg.run(tx, pg.setMetaStatement("legacy_json_archive", path.basename(target)));
    });
  }

  /**
   * The SQLite file is never read again once PostgreSQL holds the data. Say
   * so when it was changed after it was copied (the site ran on SQLite
   * again), since those changes are not in PostgreSQL.
   */
  private warnAboutNewerSqlite(): void {
    const file = this.options.sqliteFile;
    if (!file) return;
    void (async () => {
      try {
        const meta = await pg.readMeta(await this.client());
        const copiedAt = meta.last_replaced_at ?? meta.initialized_at;
        if (!copiedAt || !fs.existsSync(/* turbopackIgnore: true */ file)) return;
        if (fs.statSync(/* turbopackIgnore: true */ file).mtime.toISOString() > copiedAt) {
          console.warn(
            `[db] ${file} was changed after its data was copied to PostgreSQL; those changes are not used (DB_DRIVER=postgres). Copy it again with "npm run db:to-postgres -- --force" if they matter.`,
          );
        }
      } catch {
        // Only a hint.
      }
    })();
  }
}
