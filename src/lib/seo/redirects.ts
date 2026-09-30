/**
 * Slug redirects (pure logic shared by the proxy, the content index and tests).
 *
 * When a course, batch, program, job, blog post or category changes its slug
 * the old path keeps working with a permanent redirect. Rules are kept
 * collapsed: A→B followed by B→C becomes A→C and B→C, and a path that is live
 * again (renamed back) stops redirecting. Sub-paths follow their parent, so
 * `/courses/old/learn/1-2` goes to `/courses/new/learn/1-2`.
 */

export interface RedirectRule {
  from: string;
  to: string;
}

/** Path-only form used for matching: leading slash, no trailing slash, no query/hash, lower-case. */
export function redirectKey(path: string): string {
  const bare = (path.split(/[?#]/, 1)[0] ?? "").trim();
  const withSlash = bare.startsWith("/") ? bare : `/${bare}`;
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
  let decoded = trimmed;
  try {
    decoded = decodeURI(trimmed);
  } catch {
    // Keep malformed encodings as they are; they simply won't match a rule.
  }
  return decoded.toLowerCase();
}

/** Add (or update) a rule, collapsing chains and removing rules for paths that are live again. */
export function addRedirect(rules: readonly RedirectRule[], fromPath: string, toPath: string): RedirectRule[] {
  const from = redirectKey(fromPath);
  const to = redirectKey(toPath);
  if (!from || !to || from === to || from === "/") return [...rules];
  const out: RedirectRule[] = [];
  for (const rule of rules) {
    const ruleFrom = redirectKey(rule.from);
    // The destination is a live page again: never redirect away from it.
    if (ruleFrom === to) continue;
    if (ruleFrom === from) continue;
    // Collapse chains: anything that pointed at the old path now points at the new one.
    const ruleTo = redirectKey(rule.to) === from ? to : rule.to;
    if (redirectKey(ruleTo) === ruleFrom) continue;
    out.push({ from: rule.from, to: ruleTo });
  }
  out.push({ from, to });
  return out;
}

/** Drop rules whose old path belongs to an existing page again (e.g. another course took the old slug). */
export function pruneShadowedRedirects(rules: readonly RedirectRule[], livePaths: Iterable<string>): RedirectRule[] {
  const live = new Set<string>();
  for (const p of livePaths) live.add(redirectKey(p));
  return rules.filter((rule) => !live.has(redirectKey(rule.from)));
}

/** Lookup table for `resolveRedirect` (keys are `redirectKey`s). */
export function buildRedirectIndex(rules: readonly RedirectRule[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const rule of rules) {
    const from = redirectKey(rule.from);
    if (from && from !== "/") index.set(from, rule.to);
  }
  return index;
}

const MAX_HOPS = 5;

/**
 * Where `pathname` should permanently redirect to, or null. Tries the full
 * path, then each parent path (keeping the remainder), and follows at most a
 * few hops so a corrupted rule set can never loop.
 */
export function resolveRedirect(index: ReadonlyMap<string, string>, pathname: string): string | null {
  if (!index.size) return null;
  let current = pathname;
  let moved = false;
  const seen = new Set<string>();
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const key = redirectKey(current);
    if (seen.has(key)) return null;
    seen.add(key);
    const next = matchOnce(index, current);
    if (next === null) break;
    current = next;
    moved = true;
  }
  if (!moved || redirectKey(current) === redirectKey(pathname)) return null;
  return current;
}

function matchOnce(index: ReadonlyMap<string, string>, pathname: string): string | null {
  const key = redirectKey(pathname);
  const exact = index.get(key);
  if (exact) return exact;
  // Parent paths: /a/b/c/d → /a/b/c → /a/b. Sub-pages follow a moved item (two or more
  // segments deep); a one-segment rule only ever matches exactly, never a whole section.
  const original = pathname.split(/[?#]/, 1)[0]!.replace(/\/+$/, "");
  const originalSegments = original.split("/");
  const keySegments = key.split("/");
  for (let n = keySegments.length - 1; n >= 3; n--) {
    const parent = keySegments.slice(0, n).join("/");
    const target = index.get(parent);
    if (target) {
      const rest = originalSegments.slice(n).join("/");
      return rest ? `${target.replace(/\/+$/, "")}/${rest}` : target;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Content index diffing                                               */
/* ------------------------------------------------------------------ */

/** One public-facing page tracked for slug changes and search-engine pings. */
export interface ContentEntry {
  path: string;
  /** Visible to anonymous visitors. */
  public: boolean;
  /** Changes whenever the content changes (updatedAt). */
  stamp: string;
}

export type ContentIndex = Record<string, ContentEntry>;

export interface ContentDiff {
  /** Old path → new path for items whose slug changed. */
  moved: RedirectRule[];
  /** Absolute paths search engines should (re)crawl: new/updated public pages and pages that went away. */
  changed: string[];
}

/** Compare two snapshots (keyed by `type:id`). */
export function diffContentIndex(prev: ContentIndex, next: ContentIndex): ContentDiff {
  const moved: RedirectRule[] = [];
  const changed = new Set<string>();
  for (const [key, entry] of Object.entries(next)) {
    const before = prev[key];
    if (before && before.path !== entry.path) moved.push({ from: before.path, to: entry.path });
    if (entry.public && (!before || !before.public || before.stamp !== entry.stamp || before.path !== entry.path)) changed.add(entry.path);
    if (before?.public && (!entry.public || before.path !== entry.path)) changed.add(before.path);
  }
  for (const [key, before] of Object.entries(prev)) {
    if (!(key in next) && before.public) changed.add(before.path);
  }
  return { moved, changed: [...changed] };
}

/* ------------------------------------------------------------------ */
/* Redirects added by hand (Admin → Settings → SEO → Redirects)        */
/* ------------------------------------------------------------------ */

export const REDIRECT_PATH_MAX = 300;

/** Areas whose addresses can never be redirected away (account, admin, sign-in, APIs, stored files). */
const PROTECTED_PREFIXES = [
  "/admin",
  "/api",
  "/_next",
  "/dashboard",
  "/settings",
  "/billing",
  "/notifications",
  "/uploads",
  "/videos",
  "/images",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/two-factor",
  "/verify-email",
];

/** Section index pages: the pages below them can be redirected, the index itself cannot. */
const SECTION_ROOTS = [
  "/courses",
  "/courses/category",
  "/courses/tag",
  "/batches",
  "/programs",
  "/jobs",
  "/blog",
  "/blog/category",
  "/blog/tag",
  "/instructors",
  "/certificates",
  "/certified-members",
  "/community",
  "/leaderboard",
  "/statistics",
  "/pricing",
  "/free",
  "/sitemap",
  "/sitemap.xml",
  "/robots.txt",
  "/rss.xml",
];

export type ManualRedirectResult = { ok: true; from: string; to: string } | { ok: false; errors: { fromPath?: string; toPath?: string } };

/** A site path from what an admin typed or pasted: a path, or a full URL of this site. Null when it points elsewhere. */
function toSitePath(raw: string, origin: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let path = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      if (url.origin !== origin) return null;
      path = url.pathname;
    } catch {
      return null;
    }
  } else if (!value.startsWith("/") || value.startsWith("//")) {
    return null;
  }
  const bare = path.split(/[?#]/, 1)[0] ?? "";
  const collapsed = bare.replace(/\/{2,}/g, "/");
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, "") : collapsed;
}

/**
 * Validate a redirect typed by an admin. Both ends must be paths on this
 * site, and the old address may not be a live page, a section index or part
 * of the account, admin and sign-in areas.
 */
export function validateManualRedirect(rawFrom: string, rawTo: string, opts: { origin: string; livePaths: Iterable<string> }): ManualRedirectResult {
  const errors: { fromPath?: string; toPath?: string } = {};
  const fromPath = toSitePath(rawFrom, opts.origin);
  const toPath = toSitePath(rawTo, opts.origin);
  const from = fromPath ? redirectKey(fromPath) : "";

  if (!rawFrom.trim()) errors.fromPath = "Enter the old address, for example /courses/old-name.";
  else if (!fromPath) errors.fromPath = "Enter a path on this site that starts with “/”.";
  else if (from === "/") errors.fromPath = "The home page cannot be redirected.";
  else if (from.length > REDIRECT_PATH_MAX) errors.fromPath = `Keep the address under ${REDIRECT_PATH_MAX} characters.`;
  else if (PROTECTED_PREFIXES.some((p) => from === p || from.startsWith(`${p}/`))) errors.fromPath = "Addresses in the account, admin and file areas cannot be redirected.";
  else if (SECTION_ROOTS.includes(from)) errors.fromPath = "This is a main page of the site. Redirect one of the pages below it instead.";
  else {
    for (const live of opts.livePaths) {
      if (redirectKey(live) === from) {
        errors.fromPath = "A page lives at this address. Change its URL first; the redirect is then created for you.";
        break;
      }
    }
  }

  if (!rawTo.trim()) errors.toPath = "Enter the address visitors should land on.";
  else if (!toPath) errors.toPath = "Enter a path on this site that starts with “/”.";
  else if (toPath.length > REDIRECT_PATH_MAX) errors.toPath = `Keep the address under ${REDIRECT_PATH_MAX} characters.`;
  else if (fromPath && redirectKey(toPath) === from) errors.toPath = "The new address is the same as the old one.";
  else if (fromPath && redirectKey(toPath).startsWith(`${from}/`)) errors.toPath = "The new address is inside the old one, which would redirect forever.";

  if (errors.fromPath || errors.toPath || !toPath) return { ok: false, errors };
  return { ok: true, from, to: toPath };
}

/** What a redirect's destination is right now. */
export type RedirectTargetStatus = "live" | "hidden" | "missing" | "page";

/** Two-segment paths that always belong to a tracked item (so a missing entry means the item is gone). */
const ITEM_PATH = /^\/(?:courses|batches|programs|jobs|blog)\/(?!category$|tag$)[^/]+$|^\/courses\/category\/[^/]+$/;

/**
 * "live": a published page; "hidden": a draft or otherwise private item;
 * "missing": the item was deleted (visitors get a 404 after the redirect);
 * "page": any other page of the site.
 */
export function redirectTargetStatus(toPath: string, index: ContentIndex): RedirectTargetStatus {
  const key = redirectKey(toPath);
  for (const entry of Object.values(index)) {
    if (redirectKey(entry.path) === key) return entry.public ? "live" : "hidden";
  }
  return ITEM_PATH.test(key) ? "missing" : "page";
}
