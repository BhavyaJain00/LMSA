/**
 * Shared rules of the landing pages that power internal linking: category,
 * topic (tag) and instructor pages. Pure, so pages, the sitemap and tests
 * agree on sorting, paging and which pages are worth indexing.
 */

export const LANDING_PAGE_SIZE = 12;
export const INSTRUCTORS_PAGE_SIZE = 12;

export const LANDING_SORTS = [
  { value: "popular", label: "Most popular" },
  { value: "newest", label: "Newest" },
  { value: "rating", label: "Top rated" },
] as const;

export type LandingSort = (typeof LANDING_SORTS)[number]["value"];
export const DEFAULT_LANDING_SORT: LandingSort = "popular";

export function parseLandingSort(raw: string | string[] | undefined): LandingSort {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return LANDING_SORTS.find((s) => s.value === value)?.value ?? DEFAULT_LANDING_SORT;
}

/** `?page=` as a whole number ≥ 1 (anything else is page 1). */
export function parsePageParam(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  return Math.max(1, Number(value));
}

export interface Paged<T> {
  items: T[];
  page: number;
  pages: number;
  total: number;
}

/** One page of a list; out-of-range pages clamp to the last one. */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Paged<T> {
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { items: items.slice((current - 1) * pageSize, current * pageSize), page: current, pages, total: items.length };
}

/**
 * Link to a landing page in a given state. Defaults are left out so the first
 * page in the default order is always the bare (canonical) URL.
 */
export function landingHref(base: string, state: { sort?: string; page?: number; q?: string } = {}): string {
  const params = new URLSearchParams();
  const q = state.q?.trim();
  if (q) params.set("q", q);
  if (state.sort && state.sort !== DEFAULT_LANDING_SORT) params.set("sort", state.sort);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

/**
 * A topic page with a single course repeats that course's own page, so it is
 * kept out of the index and the sitemap (its links are still followed).
 */
export const TAG_MIN_COURSES_TO_INDEX = 2;

export function isTagIndexable(courseCount: number): boolean {
  return courseCount >= TAG_MIN_COURSES_TO_INDEX;
}
