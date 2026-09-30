import "server-only";
import type { Bundle, Course, CourseSummary, Database, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { isAdmin } from "@/lib/auth/session";
import { getCourseSummaries } from "@/lib/data/courses";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { stripMarkdown, truncate } from "@/lib/utils";
import { ownedCourseIds } from "./access";
import { BUNDLES_PAGE_SIZE, bundleCourses, bundlePricing, filterBundles, isBundleOnSale, paginate, parseBundleSort, type BundlePricing, type BundleSort } from "./bundles";

/**
 * Read models for course bundles: the public index and detail pages, the
 * "also sold in a bundle" line on course pages, and the admin bundles tab
 * (with CSV export).
 */

function bundlesOnSale(settings: Database["settings"]): boolean {
  return settings.growth.bundlesEnabled && settings.features.courses;
}

/** What a viewer already has of a bundle (nothing for guests). */
function ownership(db: Database, viewer: Pick<User, "id"> | null, courseIds: readonly string[]): { owned: string[]; ownsAll: boolean } {
  if (!viewer || !courseIds.length) return { owned: [], ownsAll: false };
  const owned = ownedCourseIds(db, viewer.id, courseIds);
  return { owned, ownsAll: owned.length === courseIds.length };
}

/* ------------------------------------------------------------------ */
/* Public index                                                        */
/* ------------------------------------------------------------------ */

export interface BundleCardData {
  id: string;
  slug: string;
  title: string;
  /** Plain-text excerpt of the description. */
  description: string;
  imageUrl?: string;
  price: number;
  currency: string;
  createdAt: string;
  /** Published courses of the bundle, in order. */
  courses: { id: string; title: string; imageUrl?: string; cardGradient: string }[];
  courseTitles: string[];
  lessonCount: number;
  durationSeconds: number;
  totalValue: number;
  savings: number;
  savingsPercent: number;
  comparable: boolean;
  /** The viewer already has every course of the bundle. */
  ownsAll: boolean;
}

export interface BundleCatalog {
  /** False when bundles are switched off: the pages show an explanation instead. */
  enabled: boolean;
  items: BundleCardData[];
  /** Bundles matching the search. */
  total: number;
  /** Bundles on sale, whatever the search. */
  available: number;
  page: number;
  pageCount: number;
  q: string;
  sort: BundleSort;
}

function lessonTotals(db: Pick<Database, "lessons">, courseIds: ReadonlySet<string>): Map<string, { count: number; duration: number }> {
  const totals = new Map<string, { count: number; duration: number }>();
  for (const lesson of db.lessons) {
    if (!courseIds.has(lesson.courseId)) continue;
    const entry = totals.get(lesson.courseId) ?? { count: 0, duration: 0 };
    entry.count++;
    entry.duration += lesson.durationSeconds;
    totals.set(lesson.courseId, entry);
  }
  return totals;
}

function toCard(db: Database, bundle: Bundle, viewer: Pick<User, "id"> | null, totals: Map<string, { count: number; duration: number }>): BundleCardData {
  const courses = bundleCourses(bundle, db.courses).filter((c) => c.published);
  const pricing = bundlePricing(bundle, courses);
  return {
    id: bundle.id,
    slug: bundle.slug,
    title: bundle.title,
    description: truncate(stripMarkdown(bundle.description), 180),
    imageUrl: bundle.imageUrl,
    price: bundle.price,
    currency: bundle.currency,
    createdAt: bundle.createdAt,
    courses: courses.map((c) => ({ id: c.id, title: c.title, imageUrl: c.imageUrl, cardGradient: c.cardGradient })),
    courseTitles: courses.map((c) => c.title),
    lessonCount: courses.reduce((sum, c) => sum + (totals.get(c.id)?.count ?? 0), 0),
    durationSeconds: courses.reduce((sum, c) => sum + (totals.get(c.id)?.duration ?? 0), 0),
    totalValue: pricing.totalValue,
    savings: pricing.savings,
    savingsPercent: pricing.savingsPercent,
    comparable: pricing.comparable,
    ownsAll: ownership(
      db,
      viewer,
      bundleCourses(bundle, db.courses).map((c) => c.id),
    ).ownsAll,
  };
}

/** Bundles on sale for the public index: searched, sorted and paged. */
export async function getBundleCatalog(viewer: Pick<User, "id"> | null, opts: { q?: string; sort?: string; page?: number } = {}): Promise<BundleCatalog> {
  const db = await getDb();
  const q = (opts.q ?? "").trim().slice(0, 100);
  const sort = parseBundleSort(opts.sort);
  if (!bundlesOnSale(db.settings)) return { enabled: false, items: [], total: 0, available: 0, page: 1, pageCount: 1, q, sort };

  const onSale = db.bundles.filter((b) => isBundleOnSale(b, db.courses));
  const totals = lessonTotals(db, new Set(onSale.flatMap((b) => b.courseIds)));
  const cards = onSale.map((b) => toCard(db, b, viewer, totals));
  const paged = paginate(filterBundles(cards, { q, sort }), opts.page ?? 1, BUNDLES_PAGE_SIZE);
  return { enabled: true, items: paged.rows, total: paged.total, available: onSale.length, page: paged.page, pageCount: paged.pageCount, q, sort };
}

/* ------------------------------------------------------------------ */
/* Public detail                                                       */
/* ------------------------------------------------------------------ */

export interface BundleDetail {
  bundle: Bundle;
  /** Buyers can see and buy it right now. */
  onSale: boolean;
  /** Published courses of the bundle, in order, with the viewer's enrollment. */
  courses: CourseSummary[];
  /** Courses of the bundle that are not published yet (buyers get them when they launch). */
  upcomingCount: number;
  pricing: BundlePricing;
  lessonCount: number;
  durationSeconds: number;
  /** Ids of the courses the viewer already has for good. */
  ownedIds: string[];
  ownsAll: boolean;
  /** The viewer's open order for this bundle. */
  pendingOrderId: string | null;
  /** The viewer's paid order for this bundle. */
  paidOrderId: string | null;
  /** Other bundles on sale (newest first). */
  others: BundleCardData[];
}

/**
 * A bundle for its public page, or null when it does not exist or the viewer
 * may not see it (unpublished bundles and the whole section while bundles are
 * switched off are visible to administrators only).
 */
export async function getBundleDetail(slug: string, viewer: User | null): Promise<BundleDetail | null> {
  const db = await getDb();
  const bundle = db.bundles.find((b) => b.slug === slug);
  if (!bundle) return null;
  const onSale = bundlesOnSale(db.settings) && isBundleOnSale(bundle, db.courses);
  const paidOrder = viewer ? db.payments.find((p) => p.userId === viewer.id && p.itemType === "bundle" && p.itemId === bundle.id && p.status === "paid") : undefined;
  // Buyers keep their page after the bundle is withdrawn; administrators can always preview.
  if (!onSale && !paidOrder && !isAdmin(viewer)) return null;

  const included = bundleCourses(bundle, db.courses);
  const ids = new Set(included.map((c) => c.id));
  const summaries = (await getCourseSummaries(viewer, { tab: "all" })).filter((c) => ids.has(c.id) && c.published);
  const order = new Map(included.map((c, i) => [c.id, i]));
  const courses = summaries.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const own = ownership(
    db,
    viewer,
    included.map((c) => c.id),
  );
  const pending = viewer ? db.payments.find((p) => p.userId === viewer.id && p.itemType === "bundle" && p.itemId === bundle.id && p.status === "pending") : undefined;

  const otherBundles = bundlesOnSale(db.settings) ? db.bundles.filter((b) => b.id !== bundle.id && isBundleOnSale(b, db.courses)) : [];
  const totals = lessonTotals(db, new Set(otherBundles.flatMap((b) => b.courseIds)));
  const others = filterBundles(
    otherBundles.map((b) => toCard(db, b, viewer, totals)),
    { sort: "newest" },
  ).slice(0, 3);

  return {
    bundle,
    onSale,
    courses,
    upcomingCount: included.length - courses.length,
    pricing: bundlePricing(bundle, courses),
    lessonCount: courses.reduce((sum, c) => sum + c.lessonCount, 0),
    durationSeconds: courses.reduce((sum, c) => sum + c.totalDurationSeconds, 0),
    ownedIds: own.owned,
    ownsAll: own.ownsAll,
    pendingOrderId: pending?.orderId ?? null,
    paidOrderId: paidOrder?.orderId ?? null,
    others,
  };
}

export interface CourseBundleOffer {
  slug: string;
  title: string;
  price: number;
  currency: string;
  courseCount: number;
  savingsPercent: number;
}

/** The bundle on sale with the biggest saving that includes `courseId` (for the course page), or null. */
export async function bestBundleFor(courseId: string): Promise<CourseBundleOffer | null> {
  const db = await getDb();
  if (!bundlesOnSale(db.settings)) return null;
  let best: CourseBundleOffer | null = null;
  for (const bundle of db.bundles) {
    if (!bundle.courseIds.includes(courseId) || !isBundleOnSale(bundle, db.courses)) continue;
    const courses = bundleCourses(bundle, db.courses).filter((c) => c.published);
    const offer = { slug: bundle.slug, title: bundle.title, price: bundle.price, currency: bundle.currency, courseCount: courses.length, savingsPercent: bundlePricing(bundle, courses).savingsPercent };
    if (!best || offer.savingsPercent > best.savingsPercent) best = offer;
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Admin                                                               */
/* ------------------------------------------------------------------ */

export type AdminBundleStatus = "all" | "published" | "draft";

export interface AdminBundleFilter {
  status: AdminBundleStatus;
  search?: string;
  page: number;
}

export const ADMIN_BUNDLES_PAGE_SIZE = 20;

type SearchParamsRecord = Record<string, string | string[] | undefined>;

function param(sp: SearchParamsRecord | URLSearchParams, key: string): string {
  if (sp instanceof URLSearchParams) return sp.get(key) ?? "";
  const v = sp[key];
  return typeof v === "string" ? v : "";
}

/** Filters of the admin bundles tab (`bstatus`, `bq`, `bpage`: the page shares its URL with other tabs). */
export function parseAdminBundleFilter(sp: SearchParamsRecord | URLSearchParams): AdminBundleFilter {
  const status = param(sp, "bstatus");
  const page = Number(param(sp, "bpage"));
  return {
    status: status === "published" || status === "draft" ? status : "all",
    search: param(sp, "bq").trim().slice(0, 100) || undefined,
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export interface AdminBundleRow extends Bundle {
  /** Titles of the courses that still exist, in order. */
  courseTitles: string[];
  /** Ids of the existing courses (deleted ones are dropped when the bundle is saved). */
  liveCourseIds: string[];
  unpublishedCourses: number;
  missingCourses: number;
  totalValue: number;
  savingsPercent: number;
  comparable: boolean;
  /** Visible to buyers right now. */
  onSale: boolean;
  paidOrders: number;
  openOrders: number;
  /** Paid minus refunded, in the bundle's currency. */
  revenue: number;
  /** Whether it can be deleted (never ordered, gifted or used in an upsell). */
  deletable: boolean;
}

export interface BundleStats {
  total: number;
  published: number;
  sold: number;
  revenue: { currency: string; amount: number }[];
}

export interface BundleCourseOption {
  id: string;
  title: string;
  published: boolean;
  price: number;
  currency: string;
}

function adminRow(db: Database, bundle: Bundle): AdminBundleRow {
  const included = bundleCourses(bundle, db.courses);
  const pricing = bundlePricing(bundle, included);
  const orders = db.payments.filter((p) => p.itemType === "bundle" && p.itemId === bundle.id);
  const settled = orders.filter((p) => p.status === "paid" || p.status === "refunded");
  const revenue = settled.reduce((sum, p) => sum + p.amount - Math.min(p.amount, p.status === "refunded" ? (p.refundedAmount ?? p.amount) : (p.refundedAmount ?? 0)), 0);
  const referenced =
    orders.length > 0 ||
    db.gifts.some((g) => g.itemType === "bundle" && g.itemId === bundle.id) ||
    db.upsells.some((u) => (u.triggerItemType === "bundle" && u.triggerItemId === bundle.id) || (u.offerItemType === "bundle" && u.offerItemId === bundle.id));
  return {
    ...bundle,
    courseTitles: included.map((c) => c.title),
    liveCourseIds: included.map((c) => c.id),
    unpublishedCourses: included.filter((c) => !c.published).length,
    missingCourses: new Set(bundle.courseIds).size - included.length,
    totalValue: pricing.totalValue,
    savingsPercent: pricing.savingsPercent,
    comparable: pricing.comparable,
    onSale: bundlesOnSale(db.settings) && isBundleOnSale(bundle, db.courses),
    paidOrders: orders.filter((p) => p.status === "paid").length,
    openOrders: orders.filter((p) => p.status === "pending").length,
    revenue,
    deletable: !referenced,
  };
}

export function bundleStats(rows: readonly AdminBundleRow[]): BundleStats {
  const revenue = new Map<string, number>();
  for (const row of rows) if (row.revenue > 0) revenue.set(row.currency, (revenue.get(row.currency) ?? 0) + row.revenue);
  return {
    total: rows.length,
    published: rows.filter((r) => r.published).length,
    sold: rows.reduce((sum, r) => sum + r.paidOrders, 0),
    revenue: Array.from(revenue, ([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount),
  };
}

/** Bundles for the admin tab: filtered and paged, with sales numbers, overall stats and the courses a bundle can hold. */
export async function getAdminBundles(
  filter: AdminBundleFilter,
  opts: { all?: boolean } = {},
): Promise<{ rows: AdminBundleRow[]; total: number; page: number; pageCount: number; stats: BundleStats; courses: BundleCourseOption[] }> {
  const db = await getDb();
  const everything = db.bundles.map((b) => adminRow(db, b));
  const q = filter.search?.toLowerCase();
  const matched = everything
    .filter((row) => {
      if (filter.status === "published" && !row.published) return false;
      if (filter.status === "draft" && row.published) return false;
      if (q && !`${row.title} ${row.slug} ${row.courseTitles.join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const paged = paginate(matched, filter.page, ADMIN_BUNDLES_PAGE_SIZE);
  const courses = db.courses
    .map((c: Course) => ({ id: c.id, title: c.title, published: c.published, price: c.paidCourse ? c.price : 0, currency: c.currency || "USD" }))
    .sort((a, b) => a.title.localeCompare(b.title));
  return { rows: opts.all ? matched : paged.rows, total: paged.total, page: paged.page, pageCount: paged.pageCount, stats: bundleStats(everything), courses };
}

export function bundlesToCsv(rows: readonly AdminBundleRow[]): string {
  const money = (amount: number) => (amount / 100).toFixed(2);
  return toCsv([
    ["Bundle", "URL name", "Status", "Courses", "Course titles", "Price", "Currency", "Value of courses", "Saving %", "Paid orders", "Open orders", "Revenue", "Created", "Updated"],
    ...rows.map((r) => [
      r.title,
      r.slug,
      r.published ? (r.onSale ? "Published" : "Published (hidden)") : "Draft",
      String(r.courseTitles.length),
      r.courseTitles.join("; "),
      money(r.price),
      r.currency,
      r.comparable ? money(r.totalValue) : "",
      r.comparable ? String(r.savingsPercent) : "",
      String(r.paidOrders),
      String(r.openOrders),
      money(r.revenue),
      r.createdAt,
      r.updatedAt,
    ]),
  ]);
}
