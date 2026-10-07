import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent, Payment } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { REFERRAL_EVENT } from "@/lib/growth/affiliates";
import { CHECKOUT_STARTED, ENTRY_MARK, PAGE_VIEW, SIGN_UP, VISITORS_ROLLUP, VISITOR_DAY, parseBeaconPayload, parseRange } from "@/lib/growth/analytics-shared";
import { countCheckoutPurchases, funnelStages, isCheckoutPurchase, isRollup, toEventCount } from "@/lib/growth/analytics-metrics";
import { compactAnalytics, getAnalyticsReport, pageViewEvents, recordCheckoutStarted, trafficCutoffMs } from "@/lib/growth/analytics";
import { createPageViewReporter, type PageViewEnvironment } from "@/components/analytics/page-view-report";
import { makePayment, makeUser, resetDb } from "./helpers/db";

/**
 * Growth review fixes (analytics): funnel stages count people once per stage
 * and only orders that ended a checkout; a page-view beacon remounted by
 * another route group never starts a new visit; page views are folded into
 * daily counts and visitor days after a day instead of staying in memory for
 * 90 days, without changing any number of the report.
 */

const DAY = 24 * 60 * 60 * 1000;
const learner = makeUser({ id: "usr_anfx_learner", name: "Lena Learner" });

async function setup(analyticsEvents: AnalyticsEvent[] = []) {
  await resetDb({ users: [learner], analyticsEvents, settings: { email: { enabled: false }, gamification: { enabled: false } } });
}

/** A browser tab: its own reporter (one document) and its own session storage of reached stages. */
function browserTab(overrides: Partial<PageViewEnvironment> = {}) {
  const reporter = createPageViewReporter();
  const seen = new Set<string>();
  const env: PageViewEnvironment = {
    trackingRefused: false,
    consent: false,
    freshNavigation: true,
    documentReferrer: "",
    host: "learn.example.com",
    search: "",
    firstTimeAt: (stage) => !seen.has(stage) && !!seen.add(stage),
    ...overrides,
  };
  return (path: string, patch: Partial<PageViewEnvironment> = {}) => reporter(path, { ...env, ...patch });
}

describe("page-view beacon: one visit per document", () => {
  it("marks only the document's first page as the entry, with its referrer and campaign", () => {
    const view = browserTab({ documentReferrer: "https://news.example.org/post/1", search: "?utm_source=news&utm_campaign=june" });
    const first = view("/")!;
    assert.equal(first.entry, true);
    assert.equal(first.referrer, "https://news.example.org");
    assert.deepEqual(first.utm, { source: "news", medium: undefined, campaign: "june" });

    // Moving to another route group remounts <PageViewBeacon />, but the document (and its reporter) is the same.
    const afterRemount = view("/learn/js/intro")!;
    assert.equal(afterRemount.entry, false);
    assert.equal(afterRemount.referrer, undefined);
    assert.equal(afterRemount.utm, undefined);
    assert.equal(view("/dashboard")!.entry, false);
  });

  it("does not start a visit on a reload or when coming from this site", () => {
    assert.equal(browserTab({ freshNavigation: false })("/")!.entry, false);
    assert.equal(browserTab({ documentReferrer: "https://learn.example.com/courses" })("/")!.entry, false);
  });

  it("sends nothing with Do-Not-Track, and the next page is still not an entry", () => {
    const view = browserTab();
    assert.equal(view("/", { trackingRefused: true }), null);
    assert.equal(view("/courses", { trackingRefused: false })!.entry, false);
  });

  it("marks the first page of the tab at each funnel stage only", () => {
    const view = browserTab();
    assert.equal(view("/")!.firstReach, undefined);
    assert.equal(view("/courses/js")!.firstReach, true);
    assert.equal(view("/courses/py")!.firstReach, undefined);
    assert.equal(view("/billing/course/js")!.firstReach, true);
    assert.equal(view("/billing/course/js")!.firstReach, undefined);
  });
});

describe("funnel: each stage counts people, the last one first orders", () => {
  const base = { userId: learner.id, itemId: "crs_js", status: "paid" as const, paidAt: "2026-03-02T10:00:00.000Z" };
  const orders: Payment[] = [
    makePayment({ ...base, id: "pay_first_1" }),
    makePayment({ ...base, id: "pay_first_2", userId: "usr_other" }),
    makePayment({ ...base, id: "pay_renewal", source: "Renewal", subscriptionId: "sub_1" }),
    makePayment({ ...base, id: "pay_part_2", installmentNumber: 2, installmentsTotal: 3 }),
    makePayment({ ...base, id: "pay_bump", upsellOfPaymentId: "pay_first_1" }),
    makePayment({ ...base, id: "pay_free", amount: 0, originalAmount: 0 }),
    makePayment({ ...base, id: "pay_pending", status: "pending" }),
  ];

  it("counts only orders that ended a checkout", () => {
    assert.deepEqual(
      orders.filter(isCheckoutPurchase).map((p) => p.id),
      ["pay_first_1", "pay_first_2"],
    );
    const bounds = { startMs: Date.parse("2026-03-01T00:00:00.000Z"), endMs: Date.parse("2026-03-03T00:00:00.000Z") };
    assert.equal(countCheckoutPurchases(orders, bounds), 2);
  });

  it("counts 10 anonymous visitors once per stage however many pages they load", () => {
    const events: AnalyticsEvent[] = [];
    for (let v = 0; v < 10; v++) {
      const view = browserTab({ documentReferrer: "https://search.example.com/" });
      for (const path of ["/", "/courses/a", "/courses/b", "/courses/c", "/billing/course/js", "/billing/course/js"]) {
        const payload = parseBeaconPayload(view(path));
        assert.ok(payload);
        events.push(...pageViewEvents(payload, { host: "learn.example.com" }));
      }
    }
    const bounds = { startMs: Date.parse("2026-03-01T00:00:00.000Z"), endMs: Date.parse("2026-03-03T00:00:00.000Z") };
    const funnel = funnelStages(events.map(toEventCount), countCheckoutPurchases(orders, bounds));
    assert.deepEqual(
      funnel.map((s) => s.count),
      [10, 10, 10, 2],
    );
    assert.equal(funnel[3]!.stepRate, 20);
    assert.equal(funnel[3]!.dropOff, 80);
  });
});

describe("checkout deduplication", () => {
  it("is not cut short by rows with older dates appended after the checkout", async () => {
    await setup();
    const now = Date.now();
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c1" }, now), true);
    // A referral link (dated at the click) and a rollup row (dated at its day) land at the end of the array.
    await mutate((d) => {
      d.analyticsEvents.push({ id: "evt_link_old", name: REFERRAL_EVENT, userId: learner.id, itemType: "affiliate", itemId: "aff_x", createdAt: new Date(now - 5 * DAY).toISOString() });
      d.analyticsEvents.push({ id: "evr_old", name: VISITORS_ROLLUP, value: 3, createdAt: "2026-01-01T00:00:00.000Z" });
    });
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c1" }, now + 60_000), false);
  });
});

describe("retention: page views become daily counts and visitor days after a day", () => {
  const now = Date.parse("2026-06-15T12:00:00.000Z");
  const d3 = now - 3 * DAY;
  const d2 = now - 2 * DAY;
  const at = (ms: number) => new Date(ms).toISOString();
  const ev = (id: string, ms: number, e: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "name">): AnalyticsEvent => ({ id, createdAt: at(ms), ...e });
  const events = (): AnalyticsEvent[] => [
    // Visitor A (consented): a visit from google.com (kept raw for attribution), a course page and a checkout ...
    ev("t1", d3, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A", referrer: "google.com" }),
    ev("a2", d3 + 60_000, { name: PAGE_VIEW, path: "/courses/js", anonId: "A" }),
    ev("a3", d3 + 120_000, { name: CHECKOUT_STARTED, path: "/billing/course/js", itemType: "course", itemId: "js", anonId: "A" }),
    ev("a4", d3 + 120_000, { name: PAGE_VIEW, path: "/billing/course/js", anonId: "A" }),
    // ... and a second visit the next day, where they sign in (linking A to the member) and sign up.
    ev("a5", d2, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A" }),
    ev("a6", d2 + 60_000, { name: PAGE_VIEW, path: "/pricing", anonId: "A", userId: learner.id }),
    ev("s1", d2 + 3_600_000, { name: SIGN_UP, userId: learner.id, itemType: "signup" }),
    // An anonymous visitor (no consent): three course pages and a checkout, the first of each marked by the beacon.
    ev("n1", d3, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, referrer: "bing.com" }),
    ev("n2", d3 + 60_000, { name: PAGE_VIEW, path: "/courses/js", firstReach: true }),
    ev("n3", d3 + 90_000, { name: PAGE_VIEW, path: "/courses/py" }),
    ev("n4", d3 + 120_000, { name: CHECKOUT_STARTED, path: "/billing/course/js", itemType: "course", itemId: "js", firstReach: true }),
    // Visitor B, today: stays raw.
    ev("r1", now - 3_600_000, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "B" }),
    ev("link", d3, { name: REFERRAL_EVENT, userId: learner.id, itemType: "affiliate", itemId: "aff_1" }),
  ];
  const week = parseRange({ from: "2026-06-09", to: "2026-06-15" }, now);
  const snapshot = async (range = week) => {
    const r = await getAnalyticsReport(range, now);
    return {
      visitors: r.kpis.visitors,
      pageViews: r.kpis.pageViews,
      funnel: r.funnel.map((s) => s.count),
      landing: r.landingPages,
      referrers: r.referrers,
      consentedShare: r.tracking.consentedShare,
      series: r.series.map((s) => [s.date, s.visits, s.pageViews]),
    };
  };

  it("keeps every number while dropping the raw page views", async () => {
    await setup(events());
    const before = await snapshot();
    assert.equal(before.visitors, 3, "A once (two days), B, and the anonymous visit");
    assert.deepEqual(before.funnel, [3, 2, 2, 0]);
    assert.equal(before.referrers.find((r) => r.host === "google.com")!.signups, 1);

    const result = await compactAnalytics(now);
    assert.equal(result.compacted, 9, "a2-a6 and n1-n4");
    const rows = (await getDb()).analyticsEvents;
    const ids = new Set(rows.map((e) => e.id));
    for (const id of ["t1", "s1", "r1", "link"]) assert.ok(ids.has(id), `${id} stays raw`);
    for (const id of ["a2", "a3", "a4", "a5", "a6", "n1", "n2", "n3", "n4"]) assert.ok(!ids.has(id), `${id} is folded`);
    assert.ok(rows.filter((e) => e.name === PAGE_VIEW || e.name === CHECKOUT_STARTED).every((e) => e.id === "t1" || Date.parse(e.createdAt) >= trafficCutoffMs(now)));

    const days = rows.filter((e) => e.name === VISITOR_DAY);
    assert.deepEqual(days.map((d) => [d.createdAt.slice(0, 10), d.anonId, d.userId ?? null, d.itemType]).sort(), [
      ["2026-06-12", "A", null, "view product checkout"],
      ["2026-06-13", "A", null, "view visit"],
      ["2026-06-13", "A", learner.id, "view product"],
    ]);
    assert.ok(rows.filter(isRollup).every((e) => !e.anonId && !e.userId));

    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await compactAnalytics(now), { compacted: 0, rollups: 0 }, "running again changes nothing");
  });

  it("folds visitor days into anonymous rollups after the retention period, keeping each day's numbers", async () => {
    await setup(events());
    const oneDay = parseRange({ from: "2026-06-12", to: "2026-06-12" }, now);
    const before = await snapshot();
    const beforeDay = await snapshot(oneDay);
    await compactAnalytics(now);
    const later = now + 100 * DAY;
    const result = await compactAnalytics(later);
    assert.ok(result.compacted > 0);
    const rows = (await getDb()).analyticsEvents;
    assert.ok(!rows.some((e) => e.name === VISITOR_DAY), "no visitor days left");
    assert.ok(rows.every((e) => e.name === REFERRAL_EVENT || (!e.anonId && !e.userId)), "no ids left outside referral links");
    assert.equal(rows.find((e) => e.name === "rollup:sign_up")!.referrer, "google.com", "the sign-up keeps its attribution");
    assert.deepEqual(await snapshot(oneDay), beforeDay);
    const after = await snapshot();
    assert.deepEqual([after.pageViews, after.series, after.landing, after.referrers, after.consentedShare], [before.pageViews, before.series, before.landing, before.referrers, before.consentedShare]);
    // Without ids, a visitor seen on two days counts once per day.
    assert.equal(after.visitors, before.visitors + 1);
  });
});
