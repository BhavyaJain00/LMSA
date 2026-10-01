import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Bundle, Payment } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { applyRefund, fulfillPayment } from "@/lib/payments/fulfillment";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { bundleCourses, bundlePricing, filterBundles, isBundleOnSale, paginate, parseBundleSort, validateBundleInput, type BundleListItem } from "@/lib/commerce/bundles";
import { bundlesToCsv, getAdminBundles, getBundleCatalog, getBundleDetail, parseAdminBundleFilter } from "@/lib/commerce/bundle-views";
import { bundlesAction, saveBundleAction, setBundlesEnabledAction } from "@/lib/actions/bundles";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Course bundles: the pricing rules (value, saving, currencies), listing and
 * form validation, the checkout item "bundle" enrolling the buyer in every
 * course (and a refund taking that back), the public and admin read models,
 * and the permission checks of the bundle actions.
 */

const c = (id: string, price: number, extra: Partial<Parameters<typeof makeCourse>[0]> = {}) =>
  makeCourse({ id, slug: id, title: `Course ${id}`, paidCourse: price > 0, price, currency: "USD", published: true, ...extra });

describe("bundle pricing", () => {
  it("adds up the list prices of paid courses and rounds the saving down", () => {
    const p = bundlePricing({ price: 6000, currency: "USD" }, [c("a", 4000), c("b", 3000), c("free", 0)]);
    assert.deepEqual(p, { totalValue: 7000, savings: 1000, savingsPercent: 14, comparable: true });
  });

  it("never reports a negative saving", () => {
    const p = bundlePricing({ price: 9000, currency: "usd" }, [c("a", 4000), c("b", 3000)]);
    assert.equal(p.savings, 0);
    assert.equal(p.savingsPercent, 0);
    assert.equal(p.totalValue, 7000);
  });

  it("cannot compare a bundle with courses priced in another currency", () => {
    const p = bundlePricing({ price: 5000, currency: "USD" }, [c("a", 4000), c("b", 300000, { currency: "INR" })]);
    assert.equal(p.comparable, false);
    assert.equal(p.savings, 0);
    assert.equal(p.savingsPercent, 0);
  });

  it("shows no saving for a bundle of free courses", () => {
    assert.deepEqual(bundlePricing({ price: 1000, currency: "USD" }, [c("x", 0), c("y", 0)]), { totalValue: 0, savings: 0, savingsPercent: 0, comparable: true });
  });
});

describe("bundle contents and listing", () => {
  const courses = [c("a", 1000), c("b", 1000, { published: false }), c("c", 1000)];

  it("keeps the bundle order, skips deleted courses and duplicates", () => {
    assert.deepEqual(
      bundleCourses({ courseIds: ["c", "gone", "a", "c"] }, courses).map((x) => x.id),
      ["c", "a"],
    );
  });

  it("is on sale only when published with at least one published course", () => {
    assert.equal(isBundleOnSale({ published: true, courseIds: ["a", "b"] }, courses), true);
    assert.equal(isBundleOnSale({ published: true, courseIds: ["b", "gone"] }, courses), false);
    assert.equal(isBundleOnSale({ published: false, courseIds: ["a"] }, courses), false);
  });

  const items: BundleListItem[] = [
    { title: "Web starter", description: "HTML and CSS", price: 5000, createdAt: "2026-01-01", savingsPercent: 20, courseTitles: ["HTML basics"] },
    { title: "Data pack", description: "Numbers", price: 9000, createdAt: "2026-03-01", savingsPercent: 35, courseTitles: ["Python for data"] },
    { title: "Design duo", description: "Colours", price: 3000, createdAt: "2026-02-01", savingsPercent: 10, courseTitles: ["Figma"] },
  ];

  it("searches titles, descriptions and course titles", () => {
    assert.deepEqual(
      filterBundles(items, { q: "python" }).map((b) => b.title),
      ["Data pack"],
    );
    assert.deepEqual(
      filterBundles(items, { q: " css " }).map((b) => b.title),
      ["Web starter"],
    );
  });

  it("sorts by newest, saving and price", () => {
    assert.deepEqual(
      filterBundles(items, {}).map((b) => b.title),
      ["Data pack", "Design duo", "Web starter"],
    );
    assert.deepEqual(
      filterBundles(items, { sort: "savings" }).map((b) => b.savingsPercent),
      [35, 20, 10],
    );
    assert.deepEqual(
      filterBundles(items, { sort: "price_low" }).map((b) => b.price),
      [3000, 5000, 9000],
    );
    assert.deepEqual(
      filterBundles(items, { sort: "price_high" }).map((b) => b.price),
      [9000, 5000, 3000],
    );
    assert.equal(parseBundleSort("bogus"), "newest");
  });

  it("clamps the page to the last one", () => {
    const list = Array.from({ length: 25 }, (_, i) => i);
    assert.deepEqual(paginate(list, 9, 10), { rows: [20, 21, 22, 23, 24], page: 3, pageCount: 3, total: 25 });
    assert.deepEqual(paginate([], 2, 10), { rows: [], page: 1, pageCount: 1, total: 0 });
    assert.equal(paginate(list, 0, 10).page, 1);
  });
});

describe("bundle form validation", () => {
  const ctx = { knownCourseIds: new Set(["a", "b", "c"]), currencies: ["USD", "INR"] };
  const input = { title: "Full stack", slug: "full-stack", description: "", courseIds: ["a", "b"], price: "59.90", currency: "usd", imageUrl: "", published: true };

  it("accepts a valid bundle and normalises it", () => {
    const res = validateBundleInput({ ...input, courseIds: ["a", "b", "a"], slug: " Full-Stack " }, ctx);
    assert.ok(res.ok);
    assert.deepEqual(res.draft, { title: "Full stack", slug: "full-stack", description: "", courseIds: ["a", "b"], price: 5990, currency: "USD", imageUrl: undefined, published: true });
  });

  it("reports every invalid field", () => {
    const res = validateBundleInput({ ...input, title: "x", slug: "bad slug", courseIds: ["a"], price: "0", currency: "EUR", imageUrl: "javascript:alert(1)" }, ctx);
    assert.ok(!res.ok);
    assert.deepEqual(Object.keys(res.errors).sort(), ["courseIds", "currency", "imageUrl", "price", "slug", "title"]);
  });

  it("rejects unknown courses and malformed prices", () => {
    const res = validateBundleInput({ ...input, courseIds: ["a", "zzz"], price: "12.345" }, ctx);
    assert.ok(!res.ok);
    assert.match(res.errors.courseIds!, /no longer exist/);
    assert.ok(res.errors.price);
  });
});

/* ------------------------------------------------------------------ */
/* Store-backed                                                        */
/* ------------------------------------------------------------------ */

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const html = c("crs_html", 4000);
const css = c("crs_css", 3000);
const js = c("crs_js", 5000);
const draft = c("crs_draft", 2000, { published: false });

const bundle = (overrides: Partial<Bundle> = {}): Bundle => ({
  id: "bnd_web",
  slug: "web-starter",
  title: "Web starter",
  description: "Everything to start",
  courseIds: [html.id, css.id, js.id],
  price: 9000,
  currency: "USD",
  published: true,
  createdAt: at(-10),
  updatedAt: at(-10),
  ...overrides,
});

const bundleOrder = (overrides: Partial<Payment> = {}): Payment =>
  makePayment({ id: "pay_bundle", userId: buyer.id, itemType: "bundle", itemId: "bnd_web", itemTitle: "Web starter", amount: 9000, originalAmount: 9000, gateway: "manual", ...overrides });

async function setup(fixture: { bundles?: Bundle[]; payments?: Payment[]; enrollments?: ReturnType<typeof makeEnrollment>[]; enabled?: boolean } = {}) {
  await resetDb({
    users: [buyer, admin],
    courses: [html, css, js, draft],
    bundles: fixture.bundles ?? [bundle()],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrollments ?? [],
    settings: { email: { enabled: false }, gamification: { enabled: false }, commerce: { paymentGateway: "manual" }, growth: { bundlesEnabled: fixture.enabled ?? true } },
  });
  resetRequest();
}

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

describe("checkout item \"bundle\"", () => {
  it("enrolls the buyer in every course of the bundle, linked to the order", async () => {
    await setup({ payments: [bundleOrder()] });
    const res = await fulfillPayment("pay_bundle", undefined, { source: "admin" });
    assert.ok(res.ok);
    await settleEvents();
    const db = await getDb();
    const mine = db.enrollments.filter((e) => e.userId === buyer.id);
    assert.deepEqual(mine.map((e) => e.courseId).sort(), [css.id, html.id, js.id]);
    assert.ok(mine.every((e) => e.paymentId === "pay_bundle"));
    const access = resolveCourseAccess(db, buyer.id, js.id);
    assert.ok(access.granted && access.via === "bundle");
    // Confirming again does not duplicate anything.
    await fulfillPayment("pay_bundle", undefined, { source: "admin" });
    assert.equal((await getDb()).enrollments.filter((e) => e.userId === buyer.id).length, 3);
  });

  it("takes the courses back on a full refund, but keeps a course the buyer had before", async () => {
    const earlier = makeEnrollment({ userId: buyer.id, courseId: html.id, enrolledAt: at(-30) });
    await setup({ payments: [bundleOrder()], enrollments: [earlier] });
    await fulfillPayment("pay_bundle", undefined, { source: "admin" });
    await settleEvents();
    const refunded = await applyRefund("pay_bundle", { amount: 9000 });
    assert.ok(refunded.ok);
    await settleEvents();
    const db = await getDb();
    assert.deepEqual(
      db.enrollments.filter((e) => e.userId === buyer.id).map((e) => e.courseId),
      [html.id],
    );
  });
});

describe("bundle read models", () => {
  it("lists bundles on sale with their saving, hides drafts and the section when switched off", async () => {
    await setup({ bundles: [bundle(), bundle({ id: "bnd_draft", slug: "draft", title: "Draft", published: false, createdAt: at(-1) }), bundle({ id: "bnd_hidden", slug: "hidden", courseIds: [draft.id] })] });
    const catalog = await getBundleCatalog(null);
    assert.equal(catalog.enabled, true);
    assert.deepEqual(
      catalog.items.map((b) => b.slug),
      ["web-starter"],
    );
    assert.equal(catalog.items[0]!.savingsPercent, 25);

    await setup({ enabled: false });
    const off = await getBundleCatalog(null);
    assert.equal(off.enabled, false);
    assert.equal(off.items.length, 0);
  });

  it("shows an unpublished bundle to administrators only", async () => {
    await setup({ bundles: [bundle({ published: false })] });
    assert.equal(await getBundleDetail("web-starter", buyer), null);
    const preview = await getBundleDetail("web-starter", admin);
    assert.ok(preview);
    assert.equal(preview.onSale, false);
    assert.equal(preview.pricing.totalValue, 12000);
  });

  it("filters, pages and exports the admin list", async () => {
    await setup({
      bundles: [bundle(), bundle({ id: "bnd_two", slug: "two", title: "Second, \"quoted\"", published: false, createdAt: at(-1) })],
      payments: [bundleOrder({ status: "paid", paidAt: at(-2) })],
    });
    const filter = parseAdminBundleFilter(new URLSearchParams("bstatus=published&bq=web&bpage=x"));
    assert.deepEqual(filter, { status: "published", search: "web", page: 1 });
    const { rows, stats } = await getAdminBundles(filter);
    assert.deepEqual(
      rows.map((r) => r.id),
      ["bnd_web"],
    );
    assert.equal(rows[0]!.paidOrders, 1);
    assert.equal(rows[0]!.revenue, 9000);
    assert.equal(rows[0]!.deletable, false);
    assert.deepEqual(stats, { total: 2, published: 1, sold: 1, revenue: [{ currency: "USD", amount: 9000 }] });

    const all = await getAdminBundles(parseAdminBundleFilter({}), { all: true });
    const csv = bundlesToCsv(all.rows);
    const lines = csv.trim().split(/\r?\n/);
    assert.equal(lines.length, 3);
    assert.match(lines[0]!, /^Bundle,URL name,Status/);
    assert.ok(csv.includes('"Second, ""quoted"""'));
    assert.ok(csv.includes("90.00"));
  });
});

describe("bundle actions", () => {
  const form = (fields: Record<string, string | string[]>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const value of Array.isArray(v) ? v : [v]) fd.append(k, value);
    return fd;
  };

  it("are for administrators only", async () => {
    await setup();
    assert.ok(!(await saveBundleAction(null, form({ title: "X" }))).ok);
    await createSession(buyer.id);
    assert.ok(!(await setBundlesEnabledAction(false)).ok);
    assert.ok(!(await bundlesAction(["bnd_web"], "unpublish")).ok);
    assert.equal((await getDb()).bundles[0]!.published, true);
  });

  it("create a bundle and keep ordered bundles from being deleted", async () => {
    await setup({ payments: [bundleOrder({ status: "paid", paidAt: at(-1) })] });
    await createSession(admin.id);
    const created = await saveBundleAction(null, form({ title: "Front end", slug: "front-end", description: "", courseIds: [css.id, js.id], price: "70", currency: "USD", imageUrl: "", published: "on" }));
    assert.ok(created.ok, created.ok ? "" : created.error);
    const db = await getDb();
    const saved = db.bundles.find((b) => b.slug === "front-end");
    assert.ok(saved);
    assert.deepEqual(saved.courseIds, [css.id, js.id]);
    assert.equal(saved.price, 7000);

    const duplicateSlug = await saveBundleAction(null, form({ title: "Again", slug: "front-end", description: "", courseIds: [css.id, js.id], price: "70", currency: "USD", imageUrl: "" }));
    assert.ok(!duplicateSlug.ok);

    const deleted = await bundlesAction(["bnd_web", saved.id], "delete");
    assert.ok(deleted.ok);
    const left = (await getDb()).bundles.map((b) => b.id);
    assert.deepEqual(left, ["bnd_web"]);
  });
});
