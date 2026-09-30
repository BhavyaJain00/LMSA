import { buildRedirectIndex, resolveRedirect } from "./redirects";
import { readRedirectRulesSync, redirectFileMtimeSync } from "./files";

/**
 * Slug-redirect lookup for `src/proxy.ts`. The rule index lives in memory and
 * the file's mtime is checked at most once per second, so a request costs a
 * Map lookup (plus a `stat` call once a second) and never touches the database.
 */

const CHECK_EVERY_MS = 1000;

interface ProxyRedirectState {
  index: Map<string, string>;
  mtimeMs: number;
  checkedAt: number;
}

const g = globalThis as unknown as { __llSeoProxyRedirects?: ProxyRedirectState };
const state: ProxyRedirectState = (g.__llSeoProxyRedirects ??= { index: new Map(), mtimeMs: -1, checkedAt: 0 });

function refresh(now: number): void {
  if (now - state.checkedAt < CHECK_EVERY_MS) return;
  state.checkedAt = now;
  const mtime = redirectFileMtimeSync();
  if (mtime === state.mtimeMs) return;
  const loaded = readRedirectRulesSync();
  state.index = buildRedirectIndex(loaded?.rules ?? []);
  state.mtimeMs = loaded?.mtimeMs ?? mtime;
}

/** Target path for a moved page, or null. */
export function slugRedirectFor(pathname: string, now: number = Date.now()): string | null {
  refresh(now);
  return resolveRedirect(state.index, pathname);
}

/** Paths the proxy never looks up (the home page, framework assets, APIs). */
export function isRedirectCandidate(pathname: string): boolean {
  return pathname !== "/" && !pathname.startsWith("/_next") && !pathname.startsWith("/api/");
}
