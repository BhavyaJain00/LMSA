import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent, MembershipPlan, Subscription } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { emit, settleEvents } from "@/lib/events";
import { ANON_COOKIE, CONSENT_COOKIE, serializeConsent } from "@/lib/legal/consent-shared";
import { REFERRAL_EVENT } from "@/lib/growth/affiliates";
import { CHECKOUT_STARTED, ENTRY_MARK, PAGE_VIEW, PURCHASE, SIGN_UP, parseRange } from "@/lib/growth/analytics-shared";
import { isRollup } from "@/lib/growth/analytics-metrics";
import { compactAnalytics, getAnalyticsReport, recordCheckoutStarted, recordPageView, reportToCsv, retentionCutoffMs } from "@/lib/growth/analytics";
import { POST } from "@/app/api/analytics/route";
import { GET as exportCsv } from "@/app/(app)/admin/analytics/export/route";
import { makePayment, makeUser, resetDb, type Fixture } from "./helpers/db";
import { resetRequest } from "./helpers/request";

/**
 * Growth, items 3-5 against the real store: the page-view beacon endpoint
 * (consent, Do-Not-Track, bots, origin checks, rate limit), server-side
 * events from domain events, checkout deduplication, the 90-day retention
 * job, the admin report and its CSV export.
 */

const DAY = 24 * 60 * 60 * 1000;
const ORIGIN = "http://localhost:3000";
const BROWSER = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const VISITOR = "visitor-0123456789abcdef";

const admin = makeUser({ id: "usr_an_admin", name: "Grace Admin", roles: ["admin"] });
const learner = makeUser({ id: "usr_an_learner", name: "Lena Learner" });

async function setup(fixture: Fixture = {}) {
  await resetDb({ users: [admin, learner], ...fixture, settings: { email: { enabled: false }, gamification: { enabled: false }, ...(fixture.settings ?? {}) } });
}

async function events(): Promise<AnalyticsEvent[]> {
  return (await getDb()).analyticsEvents;
}

/** Let the `after()` tasks of the route run. */
async function drain() {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 5));
}

let ipCounter = 0;
function beacon(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/analytics`, {
    method: "POST",
    headers: { origin: ORIGIN, "user-agent": BROWSER, "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": `198.51.100.${++ipCounter % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const consentCookie = (analytics: boolean) => ({ [CONSENT_COOKIE]: serializeConsent({ analytics, marketing: false }), [ANON_COOKIE]: VISITOR });

const previousHops = process.env.TRUST_PROXY_HOPS;
before(() => {
  process.env.TRUST_PROXY_HOPS = "1";
});
after(() => {
  if (previousHops === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = previousHops;
});

describe("POST /api/analytics", () => {
  beforeEach(() => setup());

  it("stores an anonymous page view without consent (no visitor or member id)", async () => {
    resetRequest({ cookies: consentCookie(false) });
    await createSession(learner.id);
    const res = await POST(beacon({ path: "/courses/js?secret=1", entry: true, consent: false, referrer: "https://www.google.com/search?q=private", utm: { source: "News" } }));
    assert.equal(res.status, 204);
    await drain();
    const [view] = await events();
    assert.equal(view!.name, PAGE_VIEW);
    assert.equal(view!.path, "/courses/js");
    assert.equal(view!.itemType, ENTRY_MARK);
    assert.equal(view!.referrer, "google.com");
    assert.deepEqual(view!.utm, { source: "news" });
    assert.equal(view!.anonId, undefined);
    assert.equal(view!.userId, undefined);
  });

  it("adds the visitor and member ids only when consent is given in the cookie and the beacon", async () => {
    resetRequest({ cookies: consentCookie(true) });
    await createSession(learner.id);
    await POST(beacon({ path: "/pricing", entry: false, consent: true }));
    await POST(beacon({ path: "/blog", entry: false, consent: false }));
    await drain();
    const [withConsent, withdrawn] = await events();
    assert.equal(withConsent!.anonId, VISITOR);
    assert.equal(withConsent!.userId, learner.id);
    assert.equal(withConsent!.itemType, undefined, "not an entry");
    assert.equal(withdrawn!.anonId, undefined);
    assert.equal(withdrawn!.userId, undefined);
  });

  it("records nothing for Do-Not-Track, Global Privacy Control or bots", async () => {
    resetRequest();
    const optOuts: Record<string, string>[] = [{ dnt: "1" }, { "sec-gpc": "1" }, { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }, { "user-agent": "" }];
    for (const headers of optOuts) {
      const res = await POST(beacon({ path: "/", entry: true, consent: false }, headers));
      assert.equal(res.status, 204);
    }
    await drain();
    assert.equal((await events()).length, 0);
  });

  it("rejects cross-site requests and invalid bodies", async () => {
    resetRequest();
    assert.equal((await POST(beacon({ path: "/" }, { origin: "https://evil.test" }))).status, 403);
    assert.equal((await POST(beacon({ path: "/" }, { origin: "", "sec-fetch-site": "cross-site" }))).status, 403);
    assert.equal((await POST(beacon({ path: "/" }, { "sec-fetch-site": "same-origin", origin: "" }))).status, 204);
    assert.equal((await POST(beacon("{not json"))).status, 400);
    assert.equal((await POST(beacon({ path: "https://evil.test/" }))).status, 400);
    assert.equal((await POST(beacon({ path: `/${"x".repeat(5000)}` }))).status, 413);
    await drain();
    assert.equal((await events()).length, 1);
  });

  it("rate-limits one client IP", async () => {
    resetRequest();
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await POST(beacon({ path: "/", consent: false }, { "x-forwarded-for": "203.0.113.77" }))).status);
    assert.equal(statuses.filter((s) => s === 204).length, 60);
    assert.equal(statuses.at(-1), 429);
    await drain();
  });

  it("never stores a seat-invitation token and records checkout starts once per visitor", async () => {
    resetRequest({ cookies: consentCookie(true) });
    await POST(beacon({ path: "/join/Zx81kQp0aLmN3vB7cD9eF2gH", consent: true }));
    await POST(beacon({ path: "/billing/course/js-basics", consent: true }));
    await POST(beacon({ path: "/billing/course/js-basics", consent: true }));
    await drain();
    const all = await events();
    assert.ok(all.some((e) => e.path === "/join/[token]"));
    assert.ok(!all.some((e) => e.path?.includes("Zx81")));
    const starts = all.filter((e) => e.name === CHECKOUT_STARTED);
    assert.equal(starts.length, 1);
    assert.deepEqual([starts[0]!.itemType, starts[0]!.itemId, starts[0]!.anonId], ["course", "js-basics", VISITOR]);
  });
});

describe("server-side events", () => {
  beforeEach(() => setup());

  it("records purchase (value without tax), sign_up, enroll and lead once each", async () => {
    const paid = {
      paymentId: "pay_an1",
      orderId: "ORD-1",
      userId: learner.id,
      itemType: "course" as const,
      itemId: "crs_js",
      itemTitle: "JS",
      amount: 11800,
      taxAmount: 1800,
      discountAmount: 0,
      currency: "USD",
      gateway: "stripe",
    };
    emit("payment.paid", paid);
    emit("payment.paid", paid);
    emit("user.registered", { userId: learner.id, email: learner.email, name: learner.name, source: "signup" });
    emit("user.registered", { userId: admin.id, email: admin.email, name: admin.name, source: "admin" });
    emit("enrollment.created", { enrollmentId: "enr_1", userId: learner.id, courseId: "crs_js", memberType: "student" });
    emit("lead.created", { leadId: "lead_1", email: "x@example.com", source: "blog", consent: true });
    await settleEvents();
    const all = await events();
    const byName = (n: string) => all.filter((e) => e.name === n);
    assert.equal(byName(PURCHASE).length, 1);
    assert.deepEqual([byName(PURCHASE)[0]!.value, byName(PURCHASE)[0]!.currency, byName(PURCHASE)[0]!.userId], [10000, "USD", learner.id]);
    assert.equal(byName(SIGN_UP).length, 1, "admin-created accounts are not sign-ups");
    assert.equal(byName("enroll")[0]!.itemId, "crs_js");
    const lead = byName("lead")[0]!;
    assert.equal(lead.itemType, "blog");
    assert.ok(!JSON.stringify(lead).includes("x@example.com"), "no address in analytics");
  });

  it("deduplicates checkout starts within 30 minutes", async () => {
    const now = Date.now();
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c1" }, now), true);
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c1" }, now + 60_000), false);
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c2" }, now + 60_000), true);
    assert.equal(await recordCheckoutStarted({ userId: learner.id, itemType: "course", itemId: "c1" }, now + 31 * 60_000), true);
  });
});

describe("retention job", () => {
  it("folds raw events older than 90 days into rollups without changing the numbers", async () => {
    const now = Date.parse("2026-06-15T12:00:00.000Z");
    const old = Date.parse("2026-02-10T09:00:00.000Z");
    const recent = now - 5 * DAY;
    const ev = (id: string, ms: number, e: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "name">): AnalyticsEvent => ({ id, createdAt: new Date(ms).toISOString(), ...e });
    await setup({
      analyticsEvents: [
        ev("o1", old, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A", referrer: "google.com" }),
        ev("o2", old + 60_000, { name: PAGE_VIEW, path: "/courses/js", anonId: "A" }),
        ev("o3", old + 120_000, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK }),
        ev("o4", old + 180_000, { name: CHECKOUT_STARTED, itemType: "course", itemId: "js", anonId: "A" }),
        ev("o5", old + 240_000, { name: PAGE_VIEW, path: "/pricing", anonId: "A", userId: learner.id }),
        ev("o6", old + 300_000, { name: SIGN_UP, userId: learner.id }),
        ev("ref", old, { name: REFERRAL_EVENT, userId: learner.id, itemType: "affiliate", itemId: "aff_1" }),
        ev("r1", recent, { name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "B" }),
      ],
    });
    const range = parseRange({ from: "2026-02-01", to: "2026-02-28" }, now);
    const before = await getAnalyticsReport(range, now);

    const result = await compactAnalytics(now);
    assert.equal(result.compacted, 6);
    const rows = await events();
    assert.ok(rows.some((e) => e.id === "ref"), "affiliate links stay raw");
    assert.ok(rows.some((e) => e.id === "r1"), "recent events stay raw");
    assert.ok(!rows.some((e) => e.id.startsWith("o")), "old raw events are gone");
    assert.ok(rows.filter(isRollup).every((e) => !e.anonId && !e.userId && Date.parse(e.createdAt) < retentionCutoffMs(now)));
    const signupRollup = rows.find((e) => e.name === "rollup:sign_up")!;
    assert.equal(signupRollup.referrer, "google.com", "the sign-up keeps its attribution");

    const afterReport = await getAnalyticsReport(range, now);
    assert.equal(afterReport.kpis.visitors, before.kpis.visitors);
    assert.equal(afterReport.kpis.pageViews, before.kpis.pageViews);
    assert.deepEqual(
      afterReport.funnel.map((s) => s.count),
      before.funnel.map((s) => s.count),
    );
    assert.deepEqual(afterReport.referrers, before.referrers);
    assert.equal(afterReport.referrers.find((r) => r.host === "google.com")!.signups, 1);

    assert.deepEqual(await compactAnalytics(now), { compacted: 0, rollups: 0 }, "running again changes nothing");
  });
});

describe("admin report and export", () => {
  const now = Date.parse("2026-05-20T12:00:00.000Z");
  const day = (n: number) => new Date(now - n * DAY).toISOString();
  const plan: MembershipPlan = {
    id: "plan_m",
    slug: "monthly",
    name: "Monthly",
    description: "",
    interval: "month",
    price: 1500,
    currency: "USD",
    trialDays: 0,
    access: { type: "all" },
    active: true,
    features: [],
    createdAt: day(100),
    updatedAt: day(100),
  };
  const sub = (id: string, status: Subscription["status"]): Subscription => ({
    id,
    userId: learner.id,
    planId: plan.id,
    status,
    currentPeriodStart: day(3),
    currentPeriodEnd: day(-27),
    cancelAtPeriodEnd: false,
    gateway: "stripe",
    createdAt: day(3),
    updatedAt: day(3),
  });

  beforeEach(() =>
    setup({
      users: [admin, learner, makeUser({ id: "usr_an_new", createdAt: day(2) })],
      payments: [
        makePayment({ id: "pay_r1", userId: learner.id, itemId: "crs_js", itemTitle: "JavaScript", status: "paid", amount: 11800, taxAmount: 1800, paidAt: day(1), couponCode: "WELCOME", discountAmount: 1000 }),
        makePayment({ id: "pay_r2", userId: learner.id, itemId: "crs_js", itemTitle: "JavaScript", status: "refunded", amount: 5000, refundedAmount: 5000, paidAt: day(4), refundedAt: day(2) }),
        makePayment({ id: "pay_r3", userId: learner.id, itemId: "crs_old", status: "paid", amount: 9000, paidAt: day(40) }),
      ],
      plans: [plan],
      subscriptions: [sub("sub_1", "active"), sub("sub_2", "trialing")],
      analyticsEvents: [
        { id: "v1", name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, referrer: "google.com", createdAt: day(1) },
        { id: "v2", name: PAGE_VIEW, path: "/courses/js", firstReach: true, createdAt: day(1) },
        { id: "v2b", name: PAGE_VIEW, path: "/courses/py", createdAt: day(1) },
        { id: "v3", name: PAGE_VIEW, path: "/blog", itemType: ENTRY_MARK, anonId: "C", utm: { source: "news", campaign: "may" }, createdAt: day(2) },
        { id: "v4", name: CHECKOUT_STARTED, itemType: "course", itemId: "js", firstReach: true, createdAt: day(1) },
        { id: "v4b", name: CHECKOUT_STARTED, itemType: "course", itemId: "js", createdAt: day(1) },
      ],
      activities: [{ id: "act_1", userId: learner.id, date: day(1).slice(0, 10), type: "lesson_complete", createdAt: day(1) }],
    }),
  );

  it("computes KPIs, funnel, revenue, MRR and traffic tables for the period", async () => {
    const report = await getAnalyticsReport(parseRange({ range: "7" }, now), now);
    const k = report.kpis;
    assert.equal(k.visitors, 2);
    assert.equal(k.pageViews, 4);
    assert.equal(k.signups, 1);
    assert.equal(k.orders, 2);
    assert.equal(k.conversionRate, 100);
    assert.deepEqual([k.revenue.gross, k.revenue.refunds, k.revenue.net, k.revenue.refundRate], [15000, 5000, 10000, 50]);
    assert.equal(k.activeLearners, 1);
    assert.deepEqual(
      report.funnel.map((s) => s.count),
      [2, 1, 1, 2],
    );
    assert.equal(report.revenueByItem[0]!.title, "JavaScript");
    assert.equal(report.subscriptions.mrr[0]!.mrr, 1500);
    assert.equal(report.subscriptions.started, 2);
    assert.deepEqual(report.coupons, [{ code: "WELCOME", currency: "USD", orders: 1, discount: 1000, revenue: 10000 }]);
    assert.deepEqual(
      report.landingPages.map((r) => r.label),
      ["/", "/blog"],
    );
    assert.equal(report.campaigns[0]!.campaign, "may");
    assert.equal(report.series.length, 7);
    assert.equal(report.tracking.consentedShare, 25);
  });

  it("exports report sections as CSV for administrators only", async () => {
    const report = await getAnalyticsReport(parseRange({ range: "7" }, now), now);
    const csv = reportToCsv(report, "revenue").split("\r\n");
    assert.equal(csv[0], "Type,Item,Item ID,Currency,Orders,Sales (excl. tax),Refunds,Net");
    assert.equal(csv[1], "course,JavaScript,crs_js,USD,2,150,50,100");
    assert.match(reportToCsv(report, "funnel"), /Visited the site,2,100,0,100/);

    resetRequest();
    await createSession(admin.id);
    const ok = await exportCsv(new Request(`${ORIGIN}/admin/analytics/export?section=daily&range=7`) as never);
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-disposition") ?? "", /analytics-daily-/);
    const bytes = new Uint8Array(await ok.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], "UTF-8 BOM for spreadsheet apps");
    assert.match(new TextDecoder().decode(bytes), /^Date,Visits,Page views,Sign-ups,Orders,Net revenue \(USD\)/);
    assert.equal((await exportCsv(new Request(`${ORIGIN}/admin/analytics/export?section=nope`) as never)).status, 400);
    assert.ok((await getDb()).auditEvents.some((e) => e.action === "analytics.export"));

    resetRequest();
    await createSession(learner.id);
    assert.equal((await exportCsv(new Request(`${ORIGIN}/admin/analytics/export?section=daily`) as never)).status, 403);
  });

  it("stores consented page views directly through recordPageView", async () => {
    const [view] = await recordPageView({ path: "/", entry: true, consent: true, referrer: `${ORIGIN}/courses` }, { anonId: VISITOR, host: "localhost:3000" });
    assert.equal(view!.referrer, undefined, "own-site referrers are dropped");
    assert.equal(view!.anonId, VISITOR);
  });
});
