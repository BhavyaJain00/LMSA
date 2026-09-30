import "server-only";
import type { SlugRedirect } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { buildContentIndex } from "./content-index";
import { CONTENT_INDEX_FILE, readJsonFile, writeJsonFile, writeRedirectRules } from "./files";
import { submitToIndexNow } from "./indexnow-client";
import { type ContentIndex, type RedirectRule, addRedirect, diffContentIndex, pruneShadowedRedirects, redirectKey } from "./redirects";

/**
 * Keeps slug redirects and search-engine pings in step with the content,
 * whoever changed it (course editor, batch form, blog, API, import…).
 *
 * `syncContentIndex()` compares the current slugs and publish state of
 * courses, batches, programs, jobs, blog posts and categories with the last
 * snapshot (`storage/seo/content-index.json`):
 *  - a changed slug stores a `SlugRedirect` (old → new, chains collapsed)
 *    and rewrites `storage/seo/redirects.json`, which the proxy serves as 308s;
 *  - new, updated or removed public pages are submitted to IndexNow.
 *
 * It is cheap (one pass over in-memory rows), single-flight, throttled, and
 * runs after responses (the root layout schedules it with `after()`), plus
 * explicitly after blog and sales-page saves.
 */

const THROTTLE_MS = 2000;

interface SyncState {
  index: ContentIndex | null;
  running: Promise<SyncOutcome> | null;
  lastRun: number;
  redirectFileWritten: boolean;
}

export interface SyncOutcome {
  redirectsAdded: number;
  submitted: number;
}

const g = globalThis as unknown as { __llSeoSync?: SyncState };
const state: SyncState = (g.__llSeoSync ??= { index: null, running: null, lastRun: 0, redirectFileWritten: false });

const NOTHING: SyncOutcome = { redirectsAdded: 0, submitted: 0 };

export function rulesFromRows(rows: readonly SlugRedirect[]): RedirectRule[] {
  return rows.map((r) => ({ from: r.fromPath, to: r.toPath }));
}

/** Rebuild the stored rows from rules, keeping ids and dates of unchanged rules. */
export function rowsFromRules(rules: readonly RedirectRule[], previous: readonly SlugRedirect[], nowIso: string): SlugRedirect[] {
  const byFrom = new Map(previous.map((r) => [redirectKey(r.fromPath), r]));
  return rules.map((rule) => {
    const existing = byFrom.get(redirectKey(rule.from));
    if (existing && existing.toPath === rule.to) return existing;
    return { id: existing?.id ?? uid("redir"), fromPath: rule.from, toPath: rule.to, createdAt: existing?.createdAt ?? nowIso };
  });
}

function sameRules(a: readonly RedirectRule[], b: readonly RedirectRule[]): boolean {
  return a.length === b.length && a.every((r, i) => r.from === b[i]!.from && r.to === b[i]!.to);
}

async function run(): Promise<SyncOutcome> {
  // `next build` renders static pages; never write files or call search engines from there.
  if (process.env.NEXT_PHASE === "phase-production-build") return NOTHING;
  const db = await getDb();
  const next = buildContentIndex(db);
  const prev = state.index ?? (await readJsonFile<ContentIndex>(CONTENT_INDEX_FILE));

  if (!prev || typeof prev !== "object") {
    // First run: remember the current state; nothing has moved yet.
    await writeJsonFile(CONTENT_INDEX_FILE, next);
    state.index = next;
    await writeRedirectRules(rulesFromRows(db.slugRedirects));
    state.redirectFileWritten = true;
    return NOTHING;
  }

  const diff = diffContentIndex(prev, next);
  const livePaths = Object.values(next).map((e) => e.path);
  const before = rulesFromRows(db.slugRedirects);
  let rules = before;
  for (const move of diff.moved) rules = addRedirect(rules, move.from, move.to);
  rules = pruneShadowedRedirects(rules, livePaths);
  const changedRules = !sameRules(before, rules);

  if (changedRules) {
    const nowIso = new Date().toISOString();
    await mutate((d) => {
      d.slugRedirects = rowsFromRules(rules, d.slugRedirects, nowIso);
    });
  }
  if (changedRules || !state.redirectFileWritten) {
    await writeRedirectRules(rules);
    state.redirectFileWritten = true;
  }
  if (JSON.stringify(prev) !== JSON.stringify(next)) await writeJsonFile(CONTENT_INDEX_FILE, next);
  state.index = next;

  const submitted = diff.changed.length ? (await submitToIndexNow(diff.changed)).submitted : 0;
  return { redirectsAdded: Math.max(0, rules.length - before.length), submitted };
}

/**
 * Detect slug changes and publish/update events since the last run. Concurrent
 * callers share one run; calls within 2 seconds of the last one are skipped
 * unless `force` is set. Never throws.
 */
export async function syncContentIndex(opts: { force?: boolean } = {}): Promise<SyncOutcome> {
  if (state.running) return state.running;
  if (!opts.force && Date.now() - state.lastRun < THROTTLE_MS) return NOTHING;
  state.running = run()
    .catch((err) => {
      console.error("[seo] content sync failed:", err instanceof Error ? err.message : err);
      return NOTHING;
    })
    .finally(() => {
      state.running = null;
      state.lastRun = Date.now();
    });
  return state.running;
}

/** Rewrite `redirects.json` from the database (after an admin edits redirects by hand). */
export async function publishRedirectFile(): Promise<void> {
  const db = await getDb();
  await writeRedirectRules(rulesFromRows(db.slugRedirects));
  state.redirectFileWritten = true;
}
