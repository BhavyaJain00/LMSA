import type { Bundle, Course } from "@/lib/types";

/**
 * Course bundle rules (pure, client-safe): what a bundle is worth compared
 * with buying its courses one by one, listing order, and the admin form
 * validation. The bundle pages, checkout and the admin editor share these.
 */

export const MIN_BUNDLE_COURSES = 2;
export const MAX_BUNDLE_COURSES = 30;
export const BUNDLES_PAGE_SIZE = 12;

type PricedCourse = Pick<Course, "paidCourse" | "price" | "currency">;

/** What a course costs on its own (0 for free courses). */
export function courseListPrice(course: PricedCourse): number {
  return course.paidCourse && course.price > 0 ? course.price : 0;
}

export interface BundlePricing {
  /** List prices of the included courses added up (courses priced in the bundle's currency). */
  totalValue: number;
  /** What the buyer saves against `totalValue` (0 when the bundle is not cheaper). */
  savings: number;
  /** Whole percent, rounded down so the advertised saving is never overstated. */
  savingsPercent: number;
  /** False when a paid course is priced in another currency, so the value cannot be compared. */
  comparable: boolean;
}

export function bundlePricing(bundle: Pick<Bundle, "price" | "currency">, courses: readonly PricedCourse[]): BundlePricing {
  const currency = bundle.currency.toUpperCase();
  let totalValue = 0;
  let comparable = true;
  for (const course of courses) {
    const price = courseListPrice(course);
    if (price <= 0) continue;
    if ((course.currency || "USD").toUpperCase() !== currency) {
      comparable = false;
      continue;
    }
    totalValue += price;
  }
  const savings = comparable ? Math.max(0, totalValue - bundle.price) : 0;
  return { totalValue, savings, savingsPercent: totalValue > 0 ? Math.floor((savings / totalValue) * 100) : 0, comparable };
}

/** The courses of a bundle that still exist, in the bundle's order. */
export function bundleCourses<C extends Pick<Course, "id">>(bundle: Pick<Bundle, "courseIds">, courses: readonly C[]): C[] {
  const byId = new Map(courses.map((c) => [c.id, c]));
  const out: C[] = [];
  for (const id of bundle.courseIds) {
    const course = byId.get(id);
    if (course && !out.includes(course)) out.push(course);
  }
  return out;
}

/** A bundle buyers can see and check out: published, with at least one published course. */
export function isBundleOnSale(bundle: Pick<Bundle, "published" | "courseIds">, courses: readonly Pick<Course, "id" | "published">[]): boolean {
  return bundle.published && bundleCourses(bundle, courses).some((c) => c.published);
}

export type BundleSort = "newest" | "savings" | "price_low" | "price_high";

export const BUNDLE_SORT_LABELS: Record<BundleSort, string> = {
  newest: "Newest first",
  savings: "Biggest saving",
  price_low: "Price: low to high",
  price_high: "Price: high to low",
};

export function parseBundleSort(raw: string | undefined | null): BundleSort {
  return raw === "savings" || raw === "price_low" || raw === "price_high" ? raw : "newest";
}

export interface BundleListItem {
  title: string;
  description: string;
  price: number;
  createdAt: string;
  savingsPercent: number;
  courseTitles: string[];
}

/** Search (title, description, included course titles) and sort for the bundles index. */
export function filterBundles<T extends BundleListItem>(items: readonly T[], opts: { q?: string; sort?: BundleSort }): T[] {
  const q = opts.q?.trim().toLowerCase();
  const matched = q ? items.filter((b) => `${b.title} ${b.description} ${b.courseTitles.join(" ")}`.toLowerCase().includes(q)) : items.slice();
  switch (opts.sort ?? "newest") {
    case "savings":
      return matched.sort((a, b) => b.savingsPercent - a.savingsPercent || b.createdAt.localeCompare(a.createdAt));
    case "price_low":
      return matched.sort((a, b) => a.price - b.price || b.createdAt.localeCompare(a.createdAt));
    case "price_high":
      return matched.sort((a, b) => b.price - a.price || b.createdAt.localeCompare(a.createdAt));
    default:
      return matched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

/** One page of a list plus the numbers the pager needs (`page` is clamped to the last page). */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): { rows: T[]; page: number; pageCount: number; total: number } {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  return { rows: items.slice((current - 1) * pageSize, current * pageSize), page: current, pageCount, total: items.length };
}

/* ------------------------------------------------------------------ */
/* Admin form validation                                               */
/* ------------------------------------------------------------------ */

export interface BundleFormInput {
  title: string;
  slug: string;
  description: string;
  courseIds: string[];
  /** Decimal price as typed, e.g. "59.00". */
  price: string;
  currency: string;
  imageUrl: string;
  published: boolean;
}

export interface BundleDraft {
  title: string;
  slug: string;
  description: string;
  courseIds: string[];
  price: number;
  currency: string;
  imageUrl?: string;
  published: boolean;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An uploaded file path or an absolute http(s) URL. */
function isImageReference(value: string): boolean {
  if (value.length > 500 || /[\s"'<>]/.test(value)) return false;
  return /^\/(?!\/)/.test(value) || /^https?:\/\/[^/]+/i.test(value);
}

export function validateBundleInput(
  input: BundleFormInput,
  ctx: { knownCourseIds: ReadonlySet<string>; currencies: readonly string[] },
): { ok: true; draft: BundleDraft } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const title = input.title.trim();
  if (title.length < 2 || title.length > 120) errors.title = "Enter a title of 2 to 120 characters.";
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 80) errors.slug = "Use lowercase letters, numbers and hyphens only.";
  const description = input.description.trim();
  if (description.length > 8000) errors.description = "Keep the description under 8,000 characters.";

  const courseIds = [...new Set(input.courseIds.map((id) => id.trim()).filter(Boolean))];
  if (courseIds.some((id) => !ctx.knownCourseIds.has(id))) errors.courseIds = "Some selected courses no longer exist.";
  else if (courseIds.length < MIN_BUNDLE_COURSES) errors.courseIds = `Pick at least ${MIN_BUNDLE_COURSES} courses.`;
  else if (courseIds.length > MAX_BUNDLE_COURSES) errors.courseIds = `A bundle holds at most ${MAX_BUNDLE_COURSES} courses.`;

  const rawPrice = input.price.trim();
  const price = /^\d{1,7}(\.\d{1,2})?$/.test(rawPrice) ? Math.round(Number(rawPrice) * 100) : null;
  if (price === null) errors.price = "Enter a price such as 59 or 59.99.";
  else if (price <= 0) errors.price = "Bundles need a price above zero.";

  const currency = input.currency.trim().toUpperCase();
  if (!ctx.currencies.includes(currency)) errors.currency = "Choose a supported currency.";

  const imageUrl = input.imageUrl.trim();
  if (imageUrl && !isImageReference(imageUrl)) errors.imageUrl = "Upload an image or enter a full image URL.";

  if (Object.keys(errors).length || price === null) return { ok: false, errors };
  return { ok: true, draft: { title, slug, description, courseIds, price, currency, imageUrl: imageUrl || undefined, published: input.published } };
}
