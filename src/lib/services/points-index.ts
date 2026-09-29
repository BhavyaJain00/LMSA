import type { PointsEntry, PointsReason } from "@/lib/types";

/**
 * In-memory indexes over the points ledger (`db.points`).
 *
 * Every read of the leaderboard, the dashboard widget and every award used to
 * scan the whole ledger and re-parse every timestamp. The index keeps, next
 * to the ledger array:
 *
 *  - `keys`: one entry per (member, reason, refId) → O(1) idempotency checks;
 *  - per-member totals and entry sets → O(1) "points before this award" and
 *    O(own entries) per-member queries;
 *  - per local day and per course aggregates → week/month boards add up at
 *    most 31 day buckets instead of scanning the history;
 *  - parsed timestamps, per-reason totals, manual adjustments and helpful
 *    replies (for the community hub).
 *
 * The index describes one array. It is updated incrementally by the points
 * service (append on award, removal on revoke) and rebuilt from scratch when
 * the ledger was changed some other way: a different array, a different
 * length or a different last entry than the index recorded. `version` changes
 * with every update so caches built on top of it know when to recompute.
 */

export interface Agg {
  points: number;
  /** Latest entry time (ms) — when the member reached this total. */
  lastAt: number;
  count: number;
}

export interface Scope {
  /** All-time totals per member. */
  totals: Map<string, Agg>;
  /** Local day number → per-member totals of that day. */
  days: Map<number, Map<string, Agg>>;
}

export interface LedgerIndex {
  source: PointsEntry[];
  length: number;
  tail: PointsEntry | undefined;
  version: number;
  times: Map<PointsEntry, number>;
  /** `userId|reason|refId` → entry (keyed entries only: everything except manual adjustments without a refId). */
  keys: Map<string, PointsEntry>;
  /** discussion_reply refId (reply id) → entry. */
  replies: Map<string, PointsEntry>;
  /** `userId|day` → number of discussion_reply entries (daily cap). */
  replyDays: Map<string, number>;
  users: Map<string, Set<PointsEntry>>;
  all: Scope;
  courses: Map<string, Scope>;
  reasons: Map<PointsReason, { count: number; points: number }>;
  manual: Set<PointsEntry>;
  totalPoints: number;
  /** Latest entry time ever indexed (never decreases until a rebuild). */
  maxTime: number;
}

const DAY_MS = 86400000;

let versionCounter = 0;

/** Parsed entry time in ms (0 for unreadable dates). */
export function entryTime(iso: string | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

const HOUR_MS = 3600000;
/** Time zone offset per hour (offsets only change on whole hours or half hours; getTimezoneOffset is slow). */
const offsetCache = new Map<number, number>();

function offsetAt(ms: number): number {
  const hour = Math.floor(ms / HOUR_MS);
  let offset = offsetCache.get(hour);
  if (offset === undefined) {
    // Check both ends of the hour: when they differ the offset changes inside it, so do not cache.
    const start = new Date(hour * HOUR_MS).getTimezoneOffset();
    const end = new Date(hour * HOUR_MS + HOUR_MS - 1).getTimezoneOffset();
    if (start !== end) return new Date(ms).getTimezoneOffset() * 60000;
    offset = start * 60000;
    if (offsetCache.size > 50000) offsetCache.clear();
    offsetCache.set(hour, offset);
  }
  return offset;
}

/** Local calendar day number of an instant (consistent with `toDateKey`, DST-safe). */
export function localDay(ms: number): number {
  return Math.floor((ms - offsetAt(ms)) / DAY_MS);
}

export function pointsKey(userId: string, reason: PointsReason, refId: string | undefined): string {
  return `${userId}|${reason}|${refId ?? ""}`;
}

export function isKeyedEntry(e: Pick<PointsEntry, "reason" | "refId">): boolean {
  return e.reason !== "manual" || !!e.refId;
}

function emptyScope(): Scope {
  return { totals: new Map(), days: new Map() };
}

function aggAdd(map: Map<string, Agg>, userId: string, points: number, t: number): void {
  const a = map.get(userId);
  if (a) {
    a.points += points;
    a.count++;
    if (t > a.lastAt) a.lastAt = t;
  } else map.set(userId, { points, lastAt: t, count: 1 });
}

function aggRemove(map: Map<string, Agg>, userId: string, points: number, t: number, lastAt: () => number): void {
  const a = map.get(userId);
  if (!a) return;
  a.count--;
  a.points -= points;
  if (a.count <= 0) map.delete(userId);
  else if (t >= a.lastAt) a.lastAt = lastAt();
}

function scopeAdd(scope: Scope, e: PointsEntry, t: number, day: number): void {
  aggAdd(scope.totals, e.userId, e.points, t);
  let bucket = scope.days.get(day);
  if (!bucket) scope.days.set(day, (bucket = new Map()));
  aggAdd(bucket, e.userId, e.points, t);
}

function lastAtFor(idx: LedgerIndex, userId: string, courseId: string | null, day: number | null): number {
  let last = 0;
  for (const e of idx.users.get(userId) ?? []) {
    if (courseId !== null && e.courseId !== courseId) continue;
    const t = idx.times.get(e) ?? 0;
    if (day !== null && localDay(t) !== day) continue;
    if (t > last) last = t;
  }
  return last;
}

function scopeRemove(idx: LedgerIndex, scope: Scope, e: PointsEntry, t: number, day: number, courseId: string | null): void {
  aggRemove(scope.totals, e.userId, e.points, t, () => lastAtFor(idx, e.userId, courseId, null));
  const bucket = scope.days.get(day);
  if (bucket) {
    aggRemove(bucket, e.userId, e.points, t, () => lastAtFor(idx, e.userId, courseId, day));
    if (!bucket.size) scope.days.delete(day);
  }
}

/** Add one entry (already in the ledger array) to the index. */
export function indexAdd(idx: LedgerIndex, e: PointsEntry): void {
  const t = entryTime(e.createdAt);
  const day = localDay(t);
  idx.times.set(e, t);
  let mine = idx.users.get(e.userId);
  if (!mine) idx.users.set(e.userId, (mine = new Set()));
  mine.add(e);
  if (isKeyedEntry(e)) {
    const key = pointsKey(e.userId, e.reason, e.refId);
    if (!idx.keys.has(key)) idx.keys.set(key, e);
  }
  if (e.reason === "discussion_reply") {
    if (e.refId && !idx.replies.has(e.refId)) idx.replies.set(e.refId, e);
    const dayKey = `${e.userId}|${day}`;
    idx.replyDays.set(dayKey, (idx.replyDays.get(dayKey) ?? 0) + 1);
  }
  if (e.reason === "manual") idx.manual.add(e);
  scopeAdd(idx.all, e, t, day);
  if (e.courseId) {
    let scope = idx.courses.get(e.courseId);
    if (!scope) idx.courses.set(e.courseId, (scope = emptyScope()));
    scopeAdd(scope, e, t, day);
  }
  const r = idx.reasons.get(e.reason) ?? { count: 0, points: 0 };
  r.count++;
  r.points += e.points;
  idx.reasons.set(e.reason, r);
  idx.totalPoints += e.points;
  if (t > idx.maxTime) idx.maxTime = t;
}

/** Remove one entry (already taken out of the ledger array) from the index. */
export function indexRemove(idx: LedgerIndex, e: PointsEntry): void {
  const t = idx.times.get(e);
  if (t === undefined) return;
  const day = localDay(t);
  idx.times.delete(e);
  const mine = idx.users.get(e.userId);
  mine?.delete(e);
  if (mine && !mine.size) idx.users.delete(e.userId);
  if (isKeyedEntry(e)) {
    const key = pointsKey(e.userId, e.reason, e.refId);
    if (idx.keys.get(key) === e) {
      idx.keys.delete(key);
      // A duplicate with the same key (legacy data) takes over.
      for (const other of mine ?? []) {
        if (other.reason === e.reason && (other.refId ?? "") === (e.refId ?? "")) {
          idx.keys.set(key, other);
          break;
        }
      }
    }
  }
  if (e.reason === "discussion_reply") {
    if (e.refId && idx.replies.get(e.refId) === e) idx.replies.delete(e.refId);
    const dayKey = `${e.userId}|${day}`;
    const n = (idx.replyDays.get(dayKey) ?? 1) - 1;
    if (n > 0) idx.replyDays.set(dayKey, n);
    else idx.replyDays.delete(dayKey);
  }
  if (e.reason === "manual") idx.manual.delete(e);
  scopeRemove(idx, idx.all, e, t, day, null);
  if (e.courseId) {
    const scope = idx.courses.get(e.courseId);
    if (scope) {
      scopeRemove(idx, scope, e, t, day, e.courseId);
      if (!scope.totals.size) idx.courses.delete(e.courseId);
    }
  }
  const r = idx.reasons.get(e.reason);
  if (r) {
    r.count--;
    r.points -= e.points;
    if (r.count <= 0) idx.reasons.delete(e.reason);
  }
  idx.totalPoints -= e.points;
}

export function buildIndex(source: PointsEntry[]): LedgerIndex {
  const idx: LedgerIndex = {
    source,
    length: source.length,
    tail: source[source.length - 1],
    version: ++versionCounter,
    times: new Map(),
    keys: new Map(),
    replies: new Map(),
    replyDays: new Map(),
    users: new Map(),
    all: emptyScope(),
    courses: new Map(),
    reasons: new Map(),
    manual: new Set(),
    totalPoints: 0,
    maxTime: 0,
  };
  for (const e of source) indexAdd(idx, e);
  return idx;
}

/** Record that the indexed array now is `source` (after appends/removals applied through this module). */
export function adoptSource(idx: LedgerIndex, source: PointsEntry[]): void {
  idx.source = source;
  idx.length = source.length;
  idx.tail = source[source.length - 1];
  idx.version = ++versionCounter;
}

const holder = globalThis as unknown as { __llPointsIndex?: { index: LedgerIndex | null } };
const state = (holder.__llPointsIndex ??= { index: null });

/**
 * The index for a ledger array, brought up to date: unchanged → as is;
 * entries appended by other code → indexed incrementally; anything else
 * (another array, removals, a different last entry) → rebuilt.
 */
export function syncIndex(source: PointsEntry[]): LedgerIndex {
  const idx = state.index;
  if (idx && idx.source === source) {
    if (source.length === idx.length && source[source.length - 1] === idx.tail) return idx;
    if (source.length > idx.length && (idx.length === 0 || source[idx.length - 1] === idx.tail)) {
      for (let i = idx.length; i < source.length; i++) indexAdd(idx, source[i]!);
      adoptSource(idx, source);
      return idx;
    }
  }
  state.index = buildIndex(source);
  return state.index;
}

/** Forget the index (after bulk changes such as a recalculation); the next read rebuilds it. */
export function invalidateIndex(): void {
  state.index = null;
}

/* ------------------------------------------------------------------ */
/* Windows                                                              */
/* ------------------------------------------------------------------ */

export interface TimeWindow {
  /** Inclusive start (ms), or null for "since the beginning". Always a local midnight. */
  start: number | null;
  /** Exclusive end (ms). */
  end: number;
  /** The window ends "now" (current period) rather than at a local midnight. */
  open: boolean;
}

const EMPTY: Map<string, Agg> = new Map();

function addInto(out: Map<string, Agg>, bucket: Map<string, Agg>): void {
  for (const [userId, a] of bucket) {
    const row = out.get(userId);
    if (row) {
      row.points += a.points;
      row.count += a.count;
      if (a.lastAt > row.lastAt) row.lastAt = a.lastAt;
    } else out.set(userId, { points: a.points, lastAt: a.lastAt, count: a.count });
  }
}

/** Exact scan (used only when entries are dated after the end of an open window). */
function scanWindow(idx: LedgerIndex, courseId: string | null, w: TimeWindow): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const e of idx.source) {
    if (courseId && e.courseId !== courseId) continue;
    const t = idx.times.get(e) ?? entryTime(e.createdAt);
    if ((w.start !== null && t < w.start) || t >= w.end) continue;
    aggAdd(out, e.userId, e.points, t);
  }
  return out;
}

/**
 * Per-member totals of a window (optionally one course). The returned map
 * may be the index's own map: callers must not modify it.
 */
export function windowTotals(idx: LedgerIndex, courseId: string | null, w: TimeWindow): ReadonlyMap<string, Agg> {
  const scope = courseId ? idx.courses.get(courseId) : idx.all;
  if (!scope) return EMPTY;
  if (w.open && idx.maxTime >= w.end) return scanWindow(idx, courseId, w);
  if (w.start === null) {
    if (w.open) return scope.totals;
    // Everything before a local midnight: all-time totals minus the days from that midnight on.
    const endDay = localDay(w.end);
    const out = new Map<string, Agg>();
    for (const [userId, a] of scope.totals) out.set(userId, { points: a.points, lastAt: a.lastAt, count: a.count });
    for (const [day, bucket] of scope.days) {
      if (day < endDay) continue;
      for (const [userId, a] of bucket) {
        const row = out.get(userId);
        if (!row) continue;
        row.points -= a.points;
        row.count -= a.count;
        if (row.count <= 0) out.delete(userId);
      }
    }
    return out;
  }
  const out = new Map<string, Agg>();
  const first = localDay(w.start);
  const last = w.open ? localDay(w.end - 1) : localDay(w.end) - 1;
  for (let day = first; day <= last; day++) {
    const bucket = scope.days.get(day);
    if (bucket) addInto(out, bucket);
  }
  return out;
}
