/**
 * Caching for the generated share images (`opengraph-image` routes).
 *
 * Rendering a card (Satori + resvg) is CPU-heavy, so:
 * - cards of public items are sent with long shared-cache headers (crawlers
 *   and CDNs keep them; a changed title shows up within a day, and the page's
 *   `og:image` URL already changes with the route's content hash on deploy);
 * - the site's default card, which every missing or private item falls back
 *   to, is rendered once per brand configuration and kept in memory, so
 *   requests for random slugs cost a lookup instead of a render.
 */

/** Public items: one hour in browsers, a day in shared caches, served stale for a week while refreshing. */
export const OG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

/**
 * The fallback card (missing, private or not-yet-published items): short, so
 * an item that becomes public gets its own card soon after.
 */
export const OG_FALLBACK_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

/**
 * A one-entry async memo: `get(key, make)` returns the value made for the
 * same key last time, or makes (and keeps) a new one when the key changed.
 * A failed `make` is not kept, so the next call tries again.
 */
export function singleEntryMemo<T>() {
  let entry: { key: string; value: Promise<T> } | null = null;
  return {
    get(key: string, make: () => Promise<T>): Promise<T> {
      if (entry && entry.key === key) return entry.value;
      const value = make();
      const current = { key, value };
      entry = current;
      value.catch(() => {
        if (entry === current) entry = null;
      });
      return value;
    },
    clear(): void {
      entry = null;
    },
  };
}
