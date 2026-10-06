import type { ErrorEvent } from "@/lib/types";

/**
 * Error log helpers shared by the server recorder, the browser report route
 * and the admin pages. Pure, so they are unit tested directly.
 *
 * Occurrences are grouped by message + route: the same failure on
 * `/courses/a` and `/courses/b` is one group when Next reports the route
 * pattern (`/courses/[slug]`). Stored text never contains query strings,
 * cookies, request bodies or anything that looks like a token.
 */

export const MAX_MESSAGE_LENGTH = 1_000;
export const MAX_STACK_LENGTH = 8_000;
export const MAX_PATH_LENGTH = 300;
/** Groups kept at most; the oldest resolved (then the oldest overall) are dropped beyond it. */
export const MAX_ERROR_GROUPS = 1_000;
/** Method recorded for errors reported by browsers (error boundaries). */
export const BROWSER_METHOD = "BROWSER";

export interface ErrorInput {
  message: string;
  stack?: string;
  digest?: string;
  path?: string;
  method?: string;
  userId?: string;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  // key=value pairs whose name suggests a credential.
  [/\b((?:access_|refresh_|id_)?token|key|secret|password|passwd|pwd|signature|sig|code|auth|session|api[_-]?key)=([^&\s"'<>]+)/gi, "$1=[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, "$1_$2_[redacted]"],
  [/\b(rzp)_(live|test)_[A-Za-z0-9]{8,}/g, "$1_$2_[redacted]"],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, "sk-ant-[redacted]"],
  // postgres://user:pass@host style credentials.
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1[redacted]@"],
];

/** Remove things that look like credentials from free text. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Control characters out, secrets redacted, length capped. */
export function cleanErrorText(text: string | undefined, max: number): string | undefined {
  if (typeof text !== "string") return undefined;
  const cleaned = redactSecrets(text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n")).trim();
  return cleaned ? clamp(cleaned, max) : undefined;
}

/** Path without query string or fragment (they may carry tokens), capped. */
export function cleanErrorPath(path: string | undefined): string | undefined {
  if (typeof path !== "string" || !path) return undefined;
  let p = path.trim();
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    return undefined;
  }
  p = p.split(/[?#]/)[0] ?? "";
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/[\u0000-\u001f\u007f]/g, "");
  return clamp(p, MAX_PATH_LENGTH);
}

/**
 * Next's route file path (`/(app)/courses/[slug]/page`) as a URL pattern
 * (`/courses/[slug]`): route groups and the trailing `page`/`route` are dropped.
 */
export function normalizeRoutePath(routePath: string | undefined): string | undefined {
  if (!routePath) return undefined;
  const segments = routePath
    .split("/")
    .filter(Boolean)
    .filter((s) => !(s.startsWith("(") && s.endsWith(")")) && !s.startsWith("@"));
  const last = segments[segments.length - 1];
  if (last === "page" || last === "route" || last === "layout" || last === "default") segments.pop();
  if (segments[0] === "app" || segments[0] === "src") segments.shift();
  return `/${segments.join("/")}`;
}

/** Message used for grouping: ids, numbers and hex strings collapse, so "item 42 missing" and "item 43 missing" match. */
export function groupingMessage(message: string): string {
  return message
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, "<id>")
    .replace(/\b[a-z]{2,6}_[a-z0-9]{4,}\b/g, "<id>")
    .replace(/\b0x[0-9a-f]+\b/g, "<n>")
    .replace(/\b[0-9a-f]{12,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Group key: message + route, in separate namespaces for server errors and
 * browser reports. Anyone can send a browser report, so a report must never
 * land in (and overwrite the stack of, or reopen) a group the server logged.
 */
export function errorGroupKey(message: string, path: string | undefined, method?: string): string {
  return `${method === BROWSER_METHOD ? "browser" : "server"}|${groupingMessage(message)}|${path ?? ""}`;
}

/** Normalize an occurrence before it is stored or matched. */
export function sanitizeErrorInput(input: ErrorInput): ErrorInput {
  const method = typeof input.method === "string" ? input.method.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 10) : "";
  const digest = typeof input.digest === "string" ? input.digest.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) : "";
  return {
    message: cleanErrorText(input.message, MAX_MESSAGE_LENGTH) ?? "Unknown error",
    stack: cleanErrorText(input.stack, MAX_STACK_LENGTH),
    digest: digest || undefined,
    path: cleanErrorPath(input.path),
    method: method || undefined,
    userId: typeof input.userId === "string" && /^[\w-]{1,80}$/.test(input.userId) ? input.userId : undefined,
  };
}

/** New groups browser reports may open per rolling hour (occurrences of existing groups are always counted). */
export const MAX_NEW_BROWSER_GROUPS_PER_HOUR = 30;

/** Browser-reported groups first seen in the hour before `now`. */
export function recentBrowserGroupCount(events: readonly ErrorEvent[], now: Date): number {
  const since = now.getTime() - 60 * 60 * 1000;
  let n = 0;
  for (const e of events) if (isBrowserError(e) && new Date(e.createdAt).getTime() > since) n++;
  return n;
}

/**
 * Add one occurrence to the log (in place). Returns the group and whether it
 * is new, or null when a browser report would open a new group beyond
 * `MAX_NEW_BROWSER_GROUPS_PER_HOUR` (the report is dropped). A resolved group
 * that happens again is reopened. Browser reports only ever match browser groups.
 */
export function addErrorOccurrence(
  events: ErrorEvent[],
  rawInput: ErrorInput,
  now: Date,
  newId: () => string,
): { event: ErrorEvent; isNew: boolean; reopened: boolean } | null {
  const input = sanitizeErrorInput(rawInput);
  const key = errorGroupKey(input.message, input.path, input.method);
  const nowIso = now.toISOString();
  const existing = events.find((e) => errorGroupKey(e.message, e.path, e.method) === key);
  if (existing) {
    const reopened = existing.resolved === true;
    existing.count = (existing.count || 0) + 1;
    existing.lastSeenAt = nowIso;
    existing.message = input.message;
    if (input.stack) existing.stack = input.stack;
    if (input.digest) existing.digest = input.digest;
    if (input.method) existing.method = input.method;
    if (input.userId) existing.userId = input.userId;
    if (reopened) existing.resolved = false;
    return { event: existing, isNew: false, reopened };
  }
  if (input.method === BROWSER_METHOD && recentBrowserGroupCount(events, now) >= MAX_NEW_BROWSER_GROUPS_PER_HOUR) return null;
  const event: ErrorEvent = {
    id: newId(),
    message: input.message,
    createdAt: nowIso,
    lastSeenAt: nowIso,
    count: 1,
    resolved: false,
  };
  if (input.stack) event.stack = input.stack;
  if (input.digest) event.digest = input.digest;
  if (input.path) event.path = input.path;
  if (input.method) event.method = input.method;
  if (input.userId) event.userId = input.userId;
  events.push(event);
  return { event, isNew: true, reopened: false };
}

/**
 * Drop the oldest groups beyond `max` and return the kept list. Browser
 * reports (which anyone can send) go first, so a flood of them can never push
 * server errors out of the log; within each source resolved groups go before
 * open ones.
 */
export function capErrorGroups(events: ErrorEvent[], max: number = MAX_ERROR_GROUPS): ErrorEvent[] {
  if (events.length <= max) return events;
  const ranked = [...events].sort((a, b) => {
    if (isBrowserError(a) !== isBrowserError(b)) return isBrowserError(a) ? -1 : 1;
    if (!!a.resolved !== !!b.resolved) return a.resolved ? -1 : 1;
    return a.lastSeenAt.localeCompare(b.lastSeenAt);
  });
  const drop = new Set(ranked.slice(0, events.length - max).map((e) => e.id));
  return events.filter((e) => !drop.has(e.id));
}

export type ErrorStatusFilter = "open" | "resolved" | "all";
export type ErrorSourceFilter = "all" | "server" | "browser";

export interface ErrorFilter {
  status: ErrorStatusFilter;
  source: ErrorSourceFilter;
  q: string;
}

export function isBrowserError(event: Pick<ErrorEvent, "method">): boolean {
  return event.method === BROWSER_METHOD;
}

/** Matching groups, most recently seen first. */
export function filterErrorEvents(events: readonly ErrorEvent[], filter: ErrorFilter): ErrorEvent[] {
  const needle = filter.q.trim().toLowerCase();
  return events
    .filter((e) => {
      if (filter.status === "open" && e.resolved) return false;
      if (filter.status === "resolved" && !e.resolved) return false;
      if (filter.source === "browser" && !isBrowserError(e)) return false;
      if (filter.source === "server" && isBrowserError(e)) return false;
      if (needle && !`${e.message} ${e.path ?? ""} ${e.digest ?? ""} ${e.method ?? ""}`.toLowerCase().includes(needle)) return false;
      return true;
    })
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

const STATUS_VALUES: readonly ErrorStatusFilter[] = ["open", "resolved", "all"];
const SOURCE_VALUES: readonly ErrorSourceFilter[] = ["all", "server", "browser"];

/** Filter from query parameters (`status` defaults to open groups). */
export function parseErrorFilter(get: (key: string) => string): ErrorFilter {
  const status = get("status") as ErrorStatusFilter;
  const source = get("source") as ErrorSourceFilter;
  return {
    status: STATUS_VALUES.includes(status) ? status : "open",
    source: SOURCE_VALUES.includes(source) ? source : "all",
    q: get("q").trim().slice(0, 200),
  };
}

/** Query parameters for a filter, defaults left out so URLs stay short. */
export function errorFilterToQuery(filter: ErrorFilter): Record<string, string | undefined> {
  return {
    status: filter.status === "open" ? undefined : filter.status,
    source: filter.source === "all" ? undefined : filter.source,
    q: filter.q || undefined,
  };
}

export interface ErrorLogStats {
  open: number;
  resolved: number;
  /** Occurrences of the open groups. */
  openOccurrences: number;
  /** Groups first seen in the last 24 hours. */
  newToday: number;
  /** Open groups reported by browsers. */
  openBrowser: number;
  lastSeenAt: string | null;
}

export function errorLogStats(events: readonly ErrorEvent[], now: Date): ErrorLogStats {
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const stats: ErrorLogStats = { open: 0, resolved: 0, openOccurrences: 0, newToday: 0, openBrowser: 0, lastSeenAt: null };
  for (const e of events) {
    if (e.resolved) stats.resolved++;
    else {
      stats.open++;
      stats.openOccurrences += e.count || 0;
      if (isBrowserError(e)) stats.openBrowser++;
    }
    if (new Date(e.createdAt).getTime() >= dayAgo) stats.newToday++;
    if (!stats.lastSeenAt || e.lastSeenAt > stats.lastSeenAt) stats.lastSeenAt = e.lastSeenAt;
  }
  return stats;
}

/** Where the error came from, for badges. */
export function describeErrorSource(event: Pick<ErrorEvent, "method">): string {
  if (isBrowserError(event)) return "Browser";
  if (event.method === "ACTION") return "Server action";
  return event.method ? `Server · ${event.method}` : "Server";
}

export type StackLineKind = "message" | "app" | "framework";

export interface StackLine {
  text: string;
  kind: StackLineKind;
}

const FRAMEWORK_FRAME = /node_modules|node:internal|\(node:|next\/dist|webpack-internal:\/\/\/\(?(?:rsc|ssr|app-pages-browser)\)?\/\.\/node_modules|\[turbopack\]|<anonymous>/;

/**
 * Split a stack trace into lines, marking which frames are the app's own
 * code (shown prominently) and which belong to Node, Next or packages.
 */
export function parseStackLines(stack: string | undefined): StackLine[] {
  if (!stack) return [];
  return stack
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter(Boolean)
    .map((text) => {
      if (!/^\s*at\s/.test(text) && !/@\S+:\d+:\d+$/.test(text)) return { text, kind: "message" as const };
      return { text: text.trim(), kind: FRAMEWORK_FRAME.test(text) ? ("framework" as const) : ("app" as const) };
    });
}

/** Ids from a bulk action request: strings in the shape `uid("err")` produces, deduplicated, at most `max`. */
export function normalizeErrorIds(raw: unknown, max = MAX_ERROR_GROUPS): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
  const out = new Set<string>();
  for (const id of list) {
    if (typeof id === "string" && /^err_[a-z0-9]{6,40}$/.test(id)) out.add(id);
    if (out.size >= max) break;
  }
  return [...out];
}

/** Parse a browser error report body; null when it is not a usable report. */
export function parseBrowserReport(body: unknown): ErrorInput | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const message = typeof b.message === "string" ? b.message : "";
  const digest = typeof b.digest === "string" ? b.digest : undefined;
  if (!message.trim() && !digest) return null;
  return {
    message: message.trim() || `Server error ${digest}`,
    stack: typeof b.stack === "string" ? b.stack : undefined,
    digest,
    path: typeof b.path === "string" ? b.path : undefined,
    method: BROWSER_METHOD,
  };
}
