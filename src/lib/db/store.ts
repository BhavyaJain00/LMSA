import "server-only";
import path from "node:path";
import type { CollectionName, Database, Settings } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { databaseEnv } from "@/lib/server-env";
import { mergeSettings } from "./defaults";
import { buildInitialDatabase } from "./bootstrap";
import { buildSeedDatabase } from "./seed";
import { StoreEngine, type EngineStats } from "./engine";
import { PostgresDriver } from "./postgres";
import { describeDatabaseUrl } from "./postgres-core.mjs";
import { backupsDirIn, rawDataToJson, type RawData } from "./data-core.mjs";
import { automaticBackupState, automaticBackupsEnabled, nextLocalMidnight } from "./backup-core.mjs";
import type { DriverKind, StoreDriver } from "./driver";

/**
 * The application's data store.
 *
 * Every query in the app goes through the small API exported here (`getDb`,
 * `all`, `findById`, `insert`, `update`, `remove`, `mutate`, …). The whole
 * database is held in memory for fast reads; it is stored in PostgreSQL
 * (Supabase) through Prisma (DATABASE_URL, `postgres.ts`): only changed
 * documents are written, in one transaction per flush. An empty database is
 * filled with the demo data or the bootstrap admin (SEED_DEMO_DATA).
 * Backups are JSON exports (`backup.ts`).
 *
 * Test runs use an in-memory driver installed by the test bootstrap
 * (`tests/register.mjs`, only with NODE_ENV=test); the app never imports it.
 *
 * `mutate()` runs callbacks one at a time, so read-check-write sequences in
 * one callback are safe against concurrent requests. See `engine.ts`.
 *
 * The first request of each day also starts the automatic backup
 * (`backup.ts`; `storage/backups`, newest 14 kept, unless DB_AUTO_BACKUP=false).
 *
 * The database object and its collection arrays are tracking Proxies
 * (documents are plain objects). They read like the real thing, but
 * `structuredClone()` cannot copy a Proxy: clone documents, or use
 * `exportDatabase()` for the whole contents. Change a document through a
 * reference obtained inside the `mutate()` callback (from `db`, or with
 * `findById()`/`filter()` called in it): that is what gets written at the
 * next flush. Edits made any other way are only found by the periodic
 * comparison a few seconds later, and logged.
 *
 * The engine lives on `globalThis` so Next.js hot reloading and separately
 * bundled server entries share one cache and one connection.
 */

type Doc = { id: string };
export type CollectionDoc<K extends CollectionName> = Database[K][number];

export const COLLECTIONS: CollectionName[] = [
  "users",
  "sessions",
  "categories",
  "courses",
  "chapters",
  "lessons",
  "questions",
  "quizzes",
  "quizSubmissions",
  "quizViolations",
  "assignments",
  "assignmentSubmissions",
  "exercises",
  "exerciseSubmissions",
  "enrollments",
  "progress",
  "videoWatches",
  "notes",
  "reviews",
  "batches",
  "batchEnrollments",
  "batchFeedback",
  "liveClasses",
  "announcements",
  "emailTemplates",
  "programs",
  "programMembers",
  "certificates",
  "certificateRequests",
  "certificateEvaluations",
  "evaluatorSlots",
  "badges",
  "badgeAssignments",
  "activities",
  "notifications",
  "discussionTopics",
  "discussionReplies",
  "payments",
  "coupons",
  "jobs",
  "jobApplications",
  "emails",
  "authTokens",
  "loginEvents",
  "points",
  "loginThrottles",
  // round 3
  "uploadSessions",
  "transcodeJobs",
  "transcripts",
  "blogPosts",
  "slugRedirects",
  "leads",
  "legalPages",
  "consents",
  "auditEvents",
  "errorEvents",
  "dataRequests",
  "aiConversations",
  "aiMessages",
  "aiClarifications",
  // round 3 wave B
  "plans",
  "subscriptions",
  "bundles",
  "gifts",
  "upsells",
  "taxRules",
  "checkoutSessions",
  "affiliates",
  "affiliateReferrals",
  "commissions",
  "organizations",
  "orgSeats",
  "analyticsEvents",
  "broadcasts",
  "emailSequences",
  "sequenceEnrollments",
  "emailEvents",
  "conversations",
  "directMessages",
  "apiKeys",
  "webhookEndpoints",
  "webhookDeliveries",
  "rubrics",
  "peerReviews",
  "lessonVersions",
  "instructorProfiles",
  "earnings",
  "payouts",
];

/* ------------------------------------------------------------------ */
/* Engine setup                                                        */
/* ------------------------------------------------------------------ */

/** Bump when the engine's behaviour changes so a hot reload replaces the running one. */
const ENGINE_VERSION = 6;

interface EngineHolder {
  engine: StoreEngine;
  version: number;
  driver: DriverKind;
  file: string;
}

/**
 * Test runs only: how the test bootstrap (`tests/register.mjs`) provides the
 * in-memory driver (`tests/helpers/memory-driver.ts`). It is installed only
 * by that bootstrap, which refuses to unless NODE_ENV is "test" and records
 * so in `testRun`; no app code installs it, and a built app never loads the
 * test bootstrap. Tests may switch NODE_ENV afterwards (to check production
 * behaviour) and keep their throwaway database.
 */
export interface TestStoreHook {
  /** Always true: set by the bootstrap after checking NODE_ENV === "test". */
  readonly testRun: true;
  /** Identifies the current test database; a new value makes the store open a new engine. */
  target(): string;
  create(options: { collections: readonly string[]; backupsDir: string }): StoreDriver;
}

const g = globalThis as unknown as {
  __llStoreEngine?: EngineHolder;
  __llTestStore?: TestStoreHook;
};

/** The test driver hook, when the test bootstrap installed it (never in the app itself). */
function testStore(): TestStoreHook | null {
  const hook = g.__llTestStore;
  return hook?.testRun === true ? hook : null;
}

/** Folder of the app's own files (STORAGE_DIR), absolute. */
export function storageDir(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), siteConfig.storageDir);
}

/** Where backups (JSON exports) are written: `<STORAGE_DIR>/backups`. */
export function backupsDir(): string {
  return backupsDirIn(storageDir());
}

/** The database the store uses: the PostgreSQL connection target without credentials. */
export function databaseTarget(): string {
  return testStore()?.target() ?? describeDatabaseUrl(databaseEnv.databaseUrl);
}

/** Make sure every collection exists and settings have all keys (document objects are kept as they are). */
function normalize(data: RawData): Database {
  const db = {} as Database;
  const target = db as unknown as Record<string, unknown>;
  for (const name of COLLECTIONS) {
    const value = data.collections[name];
    target[name] = Array.isArray(value) ? value : [];
  }
  db.settings = mergeSettings((data.settings ?? undefined) as Partial<Settings> | undefined);
  return db;
}

/** A `Partial<Database>` (seed, bootstrap) as driver data. */
function toRawData(partial: Partial<Database>): RawData {
  const collections: Record<string, unknown[]> = {};
  const source = partial as unknown as Record<string, unknown>;
  for (const name of COLLECTIONS) {
    const value = source[name];
    collections[name] = Array.isArray(value) ? value : [];
  }
  return { collections, settings: partial.settings ?? null };
}

function createDriver(): StoreDriver {
  const test = testStore();
  if (test) return test.create({ collections: COLLECTIONS, backupsDir: backupsDir() });
  return new PostgresDriver({ url: databaseEnv.databaseUrl, collections: COLLECTIONS, backupsDir: backupsDir() });
}

function engine(): StoreEngine {
  const kind: DriverKind = testStore() ? "memory" : "postgres";
  const file = databaseTarget();
  const current = g.__llStoreEngine;
  // A newer engine from another bundle wins over this (older) module's version.
  if (current && current.driver === kind && current.file === file && current.version >= ENGINE_VERSION) {
    current.engine.adoptCollections(COLLECTIONS);
    return current.engine;
  }
  if (current) {
    try {
      void current.engine.close();
    } catch (err) {
      console.error("[store] could not close the previous store engine:", err);
    }
  }
  const created = new StoreEngine({
    driver: createDriver(),
    collections: COLLECTIONS,
    normalize,
    initialData: async () => toRawData(await buildInitialDatabase()),
    onOpen: (origin) => {
      if (origin === "seeded") console.info(`[store] filled the new database at ${file}.`);
    },
  });
  g.__llStoreEngine = { engine: created, version: ENGINE_VERSION, driver: kind, file };
  return created;
}

/* ------------------------------------------------------------------ */
/* Daily backup                                                        */
/* ------------------------------------------------------------------ */

/** The backup starts this long after the day's first request, so it never competes with a cold start. */
const DAILY_BACKUP_DELAY_MS = 20_000;

/**
 * Start the automatic backup on the first request of each local day (and
 * of each server start: a backup that already exists for today is left
 * alone). Costs one number comparison per call until the next midnight.
 */
function scheduleDailyBackup(): void {
  const state = automaticBackupState();
  const now = Date.now();
  if (now < state.nextCheckAt) return;
  state.nextCheckAt = nextLocalMidnight(now);
  // Nothing to back up while `next build` prerenders pages, or for the throwaway databases of test runs.
  if (!automaticBackupsEnabled() || process.env.NEXT_PHASE === "phase-production-build" || process.env.NODE_ENV === "test") return;
  const timer = setTimeout(() => {
    import("./backup")
      .then((backup) => backup.runScheduledBackup())
      .catch((err) => console.error("[store] could not start the daily backup:", err));
  }, DAILY_BACKUP_DELAY_MS);
  timer.unref?.();
}

/* ------------------------------------------------------------------ */
/* Store API                                                           */
/* ------------------------------------------------------------------ */

/** Get the in-memory database, loading (and seeding or importing) it on first access. */
export async function getDb(): Promise<Database> {
  scheduleDailyBackup();
  return engine().getDb();
}

/** Persist immediately: afterwards the storage holds exactly what is in memory. */
export async function flush(): Promise<void> {
  await engine().flush();
}

/**
 * Run a mutation against the database. Mutations are executed one at a time
 * so read-modify-write sequences inside `fn` are safe. Do not call `mutate`
 * (or `insert`/`update`/…) from inside `fn`: it would wait for itself.
 */
export async function mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  return engine().mutate(fn);
}

/* ---------------------------- Query helpers ---------------------------- */

export async function all<K extends CollectionName>(name: K): Promise<Database[K]> {
  const db = await getDb();
  return db[name];
}

export async function findById<K extends CollectionName>(
  name: K,
  id: string | undefined | null,
): Promise<CollectionDoc<K> | null> {
  if (!id) return null;
  const rows = (await all(name)) as Doc[];
  return (rows.find((r) => r.id === id) as CollectionDoc<K> | undefined) ?? null;
}

export async function findOne<K extends CollectionName>(
  name: K,
  predicate: (doc: CollectionDoc<K>) => boolean,
): Promise<CollectionDoc<K> | null> {
  const rows = (await all(name)) as CollectionDoc<K>[];
  return rows.find(predicate) ?? null;
}

export async function filter<K extends CollectionName>(
  name: K,
  predicate: (doc: CollectionDoc<K>) => boolean,
): Promise<CollectionDoc<K>[]> {
  const rows = (await all(name)) as CollectionDoc<K>[];
  return rows.filter(predicate);
}

export async function count<K extends CollectionName>(
  name: K,
  predicate?: (doc: CollectionDoc<K>) => boolean,
): Promise<number> {
  const rows = (await all(name)) as CollectionDoc<K>[];
  return predicate ? rows.filter(predicate).length : rows.length;
}

export async function insert<K extends CollectionName>(name: K, doc: CollectionDoc<K>): Promise<CollectionDoc<K>> {
  return mutate((db) => {
    (db[name] as CollectionDoc<K>[]).push(doc);
    return doc;
  });
}

export async function insertMany<K extends CollectionName>(name: K, docs: CollectionDoc<K>[]): Promise<void> {
  return mutate((db) => {
    (db[name] as CollectionDoc<K>[]).push(...docs);
  });
}

export async function update<K extends CollectionName>(
  name: K,
  id: string,
  patch: Partial<CollectionDoc<K>> | ((doc: CollectionDoc<K>) => Partial<CollectionDoc<K>> | void),
): Promise<CollectionDoc<K> | null> {
  return mutate((db) => {
    const rows = db[name] as CollectionDoc<K>[];
    const idx = rows.findIndex((r) => (r as Doc).id === id);
    if (idx === -1) return null;
    const current = rows[idx]!;
    const changes = typeof patch === "function" ? patch(current) : patch;
    const next = { ...current, ...(changes ?? {}) } as CollectionDoc<K>;
    rows[idx] = next;
    return next;
  });
}

export async function remove<K extends CollectionName>(name: K, id: string): Promise<boolean> {
  return mutate((db) => {
    const rows = db[name] as Doc[];
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    rows.splice(idx, 1);
    return true;
  });
}

export async function removeWhere<K extends CollectionName>(
  name: K,
  predicate: (doc: CollectionDoc<K>) => boolean,
): Promise<number> {
  // Compacts the array in place and records only the removed documents, so the write deletes their ids and nothing else.
  return engine().removeWhere(name, predicate as (doc: unknown) => boolean);
}

export async function getSettings() {
  const db = await getDb();
  return db.settings;
}

/** Fresh demo data in the storage format (see `BackupManager.replaceWith`). */
export async function buildDemoData(): Promise<RawData> {
  return toRawData(await buildSeedDatabase());
}

/**
 * Replace the database with fresh demo data (one transaction).
 * No backup is taken: use `BackupManager.replaceWith(await buildDemoData(), …)`
 * to keep the current data as a safety backup.
 */
export async function resetDatabase(): Promise<void> {
  await engine().replaceAll(await buildDemoData(), "demo-reset");
}

/** The current contents as a JSON export ("Download backup"). */
export async function exportDatabase(): Promise<string> {
  const store = engine();
  await store.getDb();
  return rawDataToJson(store.snapshot()!);
}

/* ------------------------------------------------------------------ */
/* Storage administration (backups, admin data page)                   */
/* ------------------------------------------------------------------ */

/** The running store engine, for backup and restore (`backup.ts`). */
export async function getStoreEngine(): Promise<StoreEngine> {
  const store = engine();
  await store.getDb();
  return store;
}

/** Persistence counters for the admin data page. */
export function getStoreStats(): EngineStats | null {
  return g.__llStoreEngine?.engine.getStats() ?? null;
}
