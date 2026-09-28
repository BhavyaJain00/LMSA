/**
 * URL helpers for the catalog query string. Shared by the server page and
 * client components so links and router updates build identical URLs.
 */

export const CATALOG_QUERY_KEYS = ["tab", "search", "category", "certification", "sort", "limit", "page"] as const;
export type CatalogQueryKey = (typeof CATALOG_QUERY_KEYS)[number];
export type CatalogParams = Partial<Record<CatalogQueryKey, string>>;

export function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Build `/courses?…` from the current params plus updates (null removes a key). */
export function catalogHref(current: CatalogParams, updates: Partial<Record<CatalogQueryKey, string | null>>): string {
  const params = new URLSearchParams();
  for (const key of CATALOG_QUERY_KEYS) {
    const value = key in updates ? updates[key] : current[key];
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `/courses?${qs}` : "/courses";
}
