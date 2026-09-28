import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { CollectionName, Database } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { mergeSettings } from "./defaults";
import { buildSeedDatabase } from "./seed";

/**
 * A tiny JSON-file database.
 *
 * - The whole database is held in memory and persisted to `storage/db.json`.
 * - Writes are serialized through a promise chain and saved atomically
 *   (write to a temp file, then rename) so a crash never corrupts the file.
 * - The cache lives on `globalThis` so Next.js hot reloading in development
 *   doesn't create multiple copies.
 *
 * Swap this module for Prisma/Drizzle later: every query in the app goes
 * through the small API exported here (`all`, `findById`, `insert`, `update`,
 * `remove`, `mutate`), so replacing the implementation is localized.
 */

type Doc = { id: string };
export type CollectionDoc<K extends CollectionName> = Database[K][number];

interface StoreState {
  db: Database | null;
  loading: Promise<Database> | null;
  writeChain: Promise<void>;
  dirty: boolean;
  flushTimer: NodeJS.Timeout | null;
}

const g = globalThis as unknown as { __llStore?: StoreState };
const state: StoreState = (g.__llStore ??= {
  db: null,
  loading: null,
  writeChain: Promise.resolve(),
  dirty: false,
  flushTimer: null,
});

const DATA_PATH = path.join(process.cwd(), siteConfig.dataFile);

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
];

/** Make sure every collection exists and settings have all keys. */
function normalize(raw: Partial<Database>): Database {
  const db = {} as Database;
  for (const name of COLLECTIONS) {
    const value = raw[name];
    (db as unknown as Record<string, unknown>)[name] = Array.isArray(value) ? value : [];
  }
  db.settings = mergeSettings(raw.settings);
  return db;
}

async function load(): Promise<Database> {
  try {
    const raw = await fs.readFile(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Database>;
    state.db = normalize(parsed);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
    state.db = normalize(await buildSeedDatabase());
    await writeFile(state.db);
  }
  return state.db;
}

async function writeFile(db: Database): Promise<void> {
  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  const tmp = `${DATA_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  await fs.rename(tmp, DATA_PATH);
}

/** Get the in-memory database, loading (and seeding) it on first access. */
export async function getDb(): Promise<Database> {
  if (state.db) return state.db;
  if (!state.loading) state.loading = load().finally(() => (state.loading = null));
  return state.loading;
}

function schedulePersist(): void {
  state.dirty = true;
  if (state.flushTimer) return;
  // Coalesce bursts of writes (e.g. progress heartbeats) into one disk write.
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flush();
  }, 150);
}

/** Persist immediately if there are pending changes. */
export async function flush(): Promise<void> {
  if (!state.dirty || !state.db) return;
  const db = state.db;
  state.dirty = false;
  state.writeChain = state.writeChain
    .then(() => writeFile(db))
    .catch((err) => {
      console.error("[store] failed to persist database", err);
      state.dirty = true;
    });
  await state.writeChain;
}

/**
 * Run a mutation against the database. Mutations are executed one at a time
 * so read-modify-write sequences inside `fn` are safe.
 */
export async function mutate<T>(fn: (db: Database) => T | Promise<T>): Promise<T> {
  const db = await getDb();
  let result!: T;
  const run = async () => {
    result = await fn(db);
    schedulePersist();
  };
  // Chain behind any in-flight mutation.
  const prev = state.writeChain;
  const current = prev.then(run, run);
  state.writeChain = current.catch(() => undefined);
  await current;
  return result;
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
  return mutate((db) => {
    const rows = db[name] as CollectionDoc<K>[];
    const keep = rows.filter((r) => !predicate(r));
    const removed = rows.length - keep.length;
    (db[name] as CollectionDoc<K>[]) = keep;
    return removed;
  });
}

export async function getSettings() {
  const db = await getDb();
  return db.settings;
}

/** Replace the database with fresh demo data. */
export async function resetDatabase(): Promise<void> {
  const fresh = normalize(await buildSeedDatabase());
  await mutate((db) => {
    for (const name of COLLECTIONS) {
      (db as unknown as Record<string, unknown>)[name] = fresh[name];
    }
    db.settings = fresh.settings;
  });
  await flush();
}

/** Export a JSON snapshot (used by the admin "Download backup" button). */
export async function exportDatabase(): Promise<string> {
  const db = await getDb();
  return JSON.stringify(db, null, 2);
}
