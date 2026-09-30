import { parseIsoTimestamp, s } from "./schema";

/**
 * Page-based pagination, sorting and `updated_since` filtering shared by
 * every list endpoint. Pure module.
 *
 * Lists answer `{ data: [...], meta: { page, perPage, total, totalPages, hasMore } }`
 * and send an RFC 8288 `Link` header with `first`, `prev`, `next` and `last`.
 */

export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 100;
/** Deepest page a client may ask for (keeps offsets bounded). */
export const MAX_PAGE = 100_000;

export const SORT_VALUES = ["created_at", "-created_at", "updated_at", "-updated_at"] as const;
export type SortValue = (typeof SORT_VALUES)[number];

/** Query parameters every list endpoint accepts. */
export const listQueryProperties = {
  page: s.integer({ optional: true, minimum: 1, maximum: MAX_PAGE, description: "Page number, starting at 1.", example: 1 }),
  perPage: s.integer({ optional: true, minimum: 1, maximum: MAX_PER_PAGE, description: `Items per page (default ${DEFAULT_PER_PAGE}, max ${MAX_PER_PAGE}). \`per_page\` is accepted too.`, example: 25 }),
  sort: s.enum(SORT_VALUES, {
    optional: true,
    description: "Sort order: a leading - sorts newest first. Default -created_at. Use updated_at with updated_since to sync changes.",
  }),
  updated_since: s.string({
    optional: true,
    format: "date-time",
    description: "Only items created or changed at or after this ISO 8601 time (a date alone means 00:00 UTC).",
    example: "2026-01-01T00:00:00Z",
  }),
};

/** `per_page` → `perPage` (both spellings are documented). */
export function normalizeListQuery(query: Record<string, string>): Record<string, string> {
  if (query.per_page !== undefined && query.perPage === undefined) {
    const { per_page, ...rest } = query;
    return { ...rest, perPage: per_page };
  }
  return query;
}

export interface PageMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface ListOptions {
  page?: number;
  perPage?: number;
  sort?: SortValue;
  updated_since?: string;
}

/** Timestamps a list sorts and filters by. `updatedAt` is when the row last changed (as far as it is known). */
export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

/** Latest of several ISO timestamps (missing ones are skipped). */
export function latest(...values: (string | undefined | null)[]): string {
  let best = "";
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!value) continue;
    const ms = Date.parse(value);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = value;
    }
  }
  return best;
}

function toMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Filter by `updated_since`, sort (ties broken by id so pages are stable)
 * and cut one page.
 */
export function listPage<T extends { id: string }>(rows: readonly T[], stamps: (row: T) => Timestamps, opts: ListOptions): Page<T> {
  const since = opts.updated_since ? parseIsoTimestamp(opts.updated_since) : null;
  const sort = opts.sort ?? "-created_at";
  const field: keyof Timestamps = sort.endsWith("updated_at") ? "updatedAt" : "createdAt";
  const direction = sort.startsWith("-") ? -1 : 1;

  const decorated = rows.map((row) => {
    const t = stamps(row);
    return { row, created: toMs(t.createdAt), updated: toMs(t.updatedAt || t.createdAt) };
  });
  const filtered = since === null ? decorated : decorated.filter((d) => Math.max(d.updated, d.created) >= since);
  filtered.sort((a, b) => {
    const diff = field === "updatedAt" ? a.updated - b.updated : a.created - b.created;
    if (diff !== 0) return diff * direction;
    return a.row.id < b.row.id ? -direction : a.row.id > b.row.id ? direction : 0;
  });
  return paginate(
    filtered.map((d) => d.row),
    opts.page,
    opts.perPage,
  );
}

/** Cut one page out of an already filtered and sorted list. */
export function paginate<T>(items: readonly T[], page: number = 1, perPage: number = DEFAULT_PER_PAGE): Page<T> {
  const size = Math.min(Math.max(1, Math.floor(perPage)), MAX_PER_PAGE);
  const current = Math.min(Math.max(1, Math.floor(page)), MAX_PAGE);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    meta: { page: current, perPage: size, total, totalPages, hasMore: start + size < total },
  };
}

/** RFC 8288 `Link` header for a page (null when everything fits on one page). */
export function linkHeader(url: URL, meta: PageMeta): string | null {
  if (meta.totalPages <= 1 && meta.page === 1) return null;
  const at = (page: number) => {
    const next = new URL(url);
    next.searchParams.delete("per_page");
    next.searchParams.set("page", String(page));
    next.searchParams.set("perPage", String(meta.perPage));
    return next.toString();
  };
  const links = [`<${at(1)}>; rel="first"`];
  if (meta.page > 1) links.push(`<${at(Math.min(meta.page - 1, meta.totalPages))}>; rel="prev"`);
  if (meta.hasMore) links.push(`<${at(meta.page + 1)}>; rel="next"`);
  links.push(`<${at(meta.totalPages)}>; rel="last"`);
  return links.join(", ");
}
