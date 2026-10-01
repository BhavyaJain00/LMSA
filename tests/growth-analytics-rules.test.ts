import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent, Payment } from "@/lib/types";
import { isBot } from "@/lib/growth/bots";
import {
  CHECKOUT_STARTED,
  ENTRY_MARK,
  PAGE_VIEW,
  PURCHASE,
  SIGN_UP,
  VISITORS_ROLLUP,
  checkoutTarget,
  coursePageSlug,
  dayKeys,
  isProductPage,
  normalizeUtm,
  optedOut,
  parseBeaconPayload,
  parseRange,
  percentChange,
  previousRange,
  rangeBounds,
  rangeQuery,
  referrerHost,
  sanitizeTrackedPath,
} from "@/lib/growth/analytics-shared";
import {
  attributeConversions,
  buildRollups,
  campaignTable,
  computeCohorts,
  computeFunnel,
  computeMrr,
  countVisitors,
  couponPerformance,
  funnelStages,
  monthlyValue,
  rankBy,
  isVisit,
  referrerTable,
  revenueByItem,
  revenueSeries,
  subscriptionMovement,
  summarizeRevenue,
  toEventCount,
  weekStartMs,
  withAttribution,
} from "@/lib/growth/analytics-metrics";

/**
 * Growth, items 3-5: the pure rules behind first-party analytics: path and
 * referrer privacy, beacon validation, date ranges, attribution, rollups,
 * funnel, revenue, MRR, cohorts and bot filtering.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-03-20T15:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

let seq = 0;
function ev(overrides: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "name">): AnalyticsEvent {
  return { id: `e${++seq}`, createdAt: iso(NOW - DAY), ...overrides };
}

function pay(overrides: Partial<Payment>): Payment {
  return {
    id: `p${++seq}`,
    orderId: `O${seq}`,
    userId: "u1",
    itemType: "course",
    itemId: "crs_a",
    itemTitle: "Course A",
    originalAmount: 10000,
    discountAmount: 0,
    taxAmount: 0,
    amount: 10000,
    currency: "USD",
    billingName: "Buyer",
    gateway: "stripe",
    status: "paid",
    createdAt: iso(NOW - DAY),
    paidAt: iso(NOW - DAY),
    ...overrides,
  };
}

describe("tracked paths", () => {
  it("strips query strings, hashes and trailing slashes", () => {
    assert.equal(sanitizeTrackedPath("/courses/js-basics/?utm_source=x#top"), "/courses/js-basics");
    assert.equal(sanitizeTrackedPath("/"), "/");
    assert.equal(sanitizeTrackedPath("/a//b"), "/a/b");
  });

  it("never stores seat-invitation tokens or other secrets", () => {
    assert.equal(sanitizeTrackedPath("/join/Zx81kQp0aLmN3vB7cD9eF2gH"), "/join/[token]");
    assert.equal(sanitizeTrackedPath("/billing/success/ORD-123"), "/billing/success/[order]");
    assert.equal(sanitizeTrackedPath("/billing/invoice/ORD-123"), "/billing/invoice/[order]");
    assert.equal(sanitizeTrackedPath("/reset/aB3dE5fG7hJ9kL1mN3pQ5r"), "/reset/[token]");
    // Long lowercase slugs are not tokens.
    assert.equal(sanitizeTrackedPath("/courses/introduction-to-machine-learning-2026"), "/courses/introduction-to-machine-learning-2026");
  });

  it("rejects anything that is not a same-site path", () => {
    for (const bad of ["https://evil.test/", "//evil.test/x", "courses", "", "/a b", "/x\\y", 42, null]) assert.equal(sanitizeTrackedPath(bad), null, String(bad));
  });

  it("caps very long paths", () => {
    assert.equal(sanitizeTrackedPath(`/${"a".repeat(500)}`)!.length, 300);
  });
});

describe("referrers and campaign tags", () => {
  it("keeps only the referring host, without www", () => {
    assert.equal(referrerHost("https://www.Google.com/search?q=secret", "learn.test"), "google.com");
    assert.equal(referrerHost("http://news.ycombinator.com/item?id=1", "learn.test"), "news.ycombinator.com");
  });

  it("drops internal, non-web and malformed referrers", () => {
    assert.equal(referrerHost("https://learn.test/courses", "learn.test:443"), undefined);
    assert.equal(referrerHost("https://www.learn.test/", "learn.test"), undefined);
    assert.equal(referrerHost("android-app://com.google.android.gm", "learn.test"), undefined);
    assert.equal(referrerHost("not a url", "learn.test"), undefined);
    assert.equal(referrerHost("", "learn.test"), undefined);
  });

  it("normalizes UTM tags from params or objects", () => {
    assert.deepEqual(normalizeUtm(new URLSearchParams("utm_source=Newsletter&utm_medium=Email&utm_campaign=%20Spring%20")), { source: "newsletter", medium: "email", campaign: "spring" });
    assert.deepEqual(normalizeUtm({ source: "X" }), { source: "x" });
    assert.equal(normalizeUtm({ source: "  " }), undefined);
    assert.equal(normalizeUtm(null), undefined);
    assert.equal(normalizeUtm({ campaign: "y".repeat(200) })!.campaign!.length, 80);
  });
});

describe("beacon payload", () => {
  it("accepts a page view and coerces flags", () => {
    assert.deepEqual(parseBeaconPayload({ path: "/courses/a?x=1", entry: true, consent: true, referrer: "https://t.co/x", utm: { source: "tw" } }), {
      path: "/courses/a",
      entry: true,
      consent: true,
      referrer: "https://t.co/x",
      utm: { source: "tw" },
    });
    assert.deepEqual(parseBeaconPayload({ path: "/", entry: "yes", consent: 1 }), { path: "/", entry: false, consent: false });
  });

  it("rejects bodies without a valid path", () => {
    for (const bad of [null, [], "x", {}, { path: "https://x.test/" }, { path: 5 }]) assert.equal(parseBeaconPayload(bad), null);
  });

  it("honours Do-Not-Track and Global Privacy Control", () => {
    assert.equal(optedOut(new Headers({ dnt: "1" })), true);
    assert.equal(optedOut(new Headers({ "sec-gpc": "1" })), true);
    assert.equal(optedOut(new Headers({ dnt: "0" })), false);
  });
});

describe("funnel paths", () => {
  it("recognizes course sales pages but not listings", () => {
    assert.equal(coursePageSlug("/courses/js-basics"), "js-basics");
    assert.equal(coursePageSlug("/courses/category"), null);
    assert.equal(coursePageSlug("/courses/js-basics/learn"), null);
    assert.equal(coursePageSlug("/courses"), null);
  });

  it("treats course, bundle and pricing pages as product pages", () => {
    assert.equal(isProductPage("/bundles/full-stack"), true);
    assert.equal(isProductPage("/pricing"), true);
    assert.equal(isProductPage("/blog/post"), false);
  });

  it("reads the item of a checkout page", () => {
    assert.deepEqual(checkoutTarget("/billing/course/js-basics"), { itemType: "course", itemId: "js-basics" });
    assert.equal(checkoutTarget("/billing/success/[order]"), null);
    assert.equal(checkoutTarget("/billing/history"), null);
  });
});

describe("date ranges", () => {
  it("defaults to the last 30 UTC days", () => {
    const r = parseRange({}, NOW);
    assert.deepEqual(r, { from: "2026-02-19", to: "2026-03-20", days: 30, preset: 30 });
    assert.equal(rangeQuery(r), "range=30");
  });

  it("accepts presets and custom ranges, swapping, capping and clipping the future", () => {
    assert.equal(parseRange({ range: "7" }, NOW).from, "2026-03-14");
    assert.equal(parseRange({ range: "12" }, NOW).days, 30);
    const custom = parseRange({ from: "2026-03-10", to: "2026-03-01" }, NOW);
    assert.deepEqual(custom, { from: "2026-03-01", to: "2026-03-10", days: 10, preset: null });
    assert.equal(rangeQuery(custom), "from=2026-03-01&to=2026-03-10");
    assert.equal(parseRange({ from: "2026-03-01", to: "2027-01-01" }, NOW).to, "2026-03-20");
    assert.equal(parseRange({ from: "2020-01-01", to: "2026-03-20" }, NOW).days, 731);
    assert.equal(parseRange({ from: "2026-02-30" }, NOW).preset, 30, "an impossible date is ignored");
  });

  it("computes the previous period, bounds and day keys", () => {
    const r = parseRange({ from: "2026-03-01", to: "2026-03-03" }, NOW);
    assert.deepEqual(previousRange(r), { from: "2026-02-26", to: "2026-02-28", days: 3, preset: null });
    assert.deepEqual(dayKeys(r), ["2026-03-01", "2026-03-02", "2026-03-03"]);
    const b = rangeBounds(r);
    assert.equal(b.endMs - b.startMs, 3 * DAY);
  });

  it("computes percent change only when there is a base", () => {
    assert.equal(percentChange(150, 100), 50);
    assert.equal(percentChange(1, 3), -66.7);
    assert.equal(percentChange(5, 0), null);
  });
});

describe("funnel computation", () => {
  it("computes step conversion, drop-off and overall conversion", () => {
    const stages = computeFunnel([
      { key: "visit", label: "Visit", count: 1000 },
      { key: "product", label: "Product", count: 400 },
      { key: "checkout", label: "Checkout", count: 50 },
      { key: "purchase", label: "Purchase", count: 20 },
    ]);
    assert.deepEqual(
      stages.map((s) => [s.stepRate, s.dropOff, s.overallRate]),
      [
        [100, 0, 100],
        [40, 60, 40],
        [12.5, 87.5, 5],
        [40, 60, 2],
      ],
    );
  });

  it("never shows a stage above 100% or divides by zero", () => {
    const stages = computeFunnel([
      { key: "a", label: "A", count: 0 },
      { key: "b", label: "B", count: 3 },
      { key: "c", label: "C", count: 5 },
    ]);
    assert.deepEqual(stages[0], { key: "a", label: "A", count: 0, stepRate: 100, dropOff: 0, overallRate: 0 });
    assert.equal(stages[1]!.stepRate, 0);
    assert.equal(stages[2]!.stepRate, 100);
    assert.equal(stages[2]!.dropOff, 0);
  });

  it("counts visitors with consent once per stage and anonymous events each time", () => {
    const counts = [
      ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A" }),
      ev({ name: PAGE_VIEW, path: "/courses/js", anonId: "A" }),
      ev({ name: PAGE_VIEW, path: "/courses/py", anonId: "A" }),
      ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK }),
      ev({ name: PAGE_VIEW, path: "/pricing" }),
      ev({ name: PAGE_VIEW, path: "/blog/x" }),
      ev({ name: CHECKOUT_STARTED, itemType: "course", itemId: "js", anonId: "A" }),
      ev({ name: CHECKOUT_STARTED, itemType: "course", itemId: "js", anonId: "A" }),
    ].map(toEventCount);
    assert.deepEqual(
      funnelStages(counts, 1).map((s) => s.count),
      [2, 2, 1, 1],
    );
  });
});

describe("visitors and traffic tables", () => {
  const events = [
    ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A", referrer: "google.com" }),
    ev({ name: PAGE_VIEW, path: "/courses/js", anonId: "A" }),
    ev({ name: PAGE_VIEW, path: "/courses/js", itemType: ENTRY_MARK, referrer: "google.com", utm: { source: "news", medium: "email", campaign: "spring" } }),
    ev({ name: PAGE_VIEW, path: "/blog", itemType: ENTRY_MARK }),
    ev({ name: PAGE_VIEW, path: "/blog/a" }),
    ev({ name: SIGN_UP, userId: "u1", referrer: "google.com" }),
    ev({ name: PURCHASE, userId: "u1", utm: { source: "news", medium: "email", campaign: "spring" }, value: 5000, currency: "USD" }),
  ];
  const counts = events.map(toEventCount);

  it("counts unique consented visitors plus anonymous visits", () => {
    assert.equal(countVisitors(counts), 3);
  });

  it("ranks landing pages by visits", () => {
    assert.deepEqual(
      rankBy(counts, isVisit, (c) => c.path ?? "/").map((r) => [r.label, r.value]),
      [
        ["/", 1],
        ["/blog", 1],
        ["/courses/js", 1],
      ],
    );
  });

  it("credits sign-ups and purchases to referrers and campaigns", () => {
    assert.deepEqual(referrerTable(counts), [
      { host: "google.com", visits: 2, signups: 1, purchases: 0 },
      { host: "(direct)", visits: 1, signups: 0, purchases: 0 },
    ]);
    assert.deepEqual(campaignTable(counts), [{ key: "news / email / spring", source: "news", medium: "email", campaign: "spring", visits: 1, signups: 0, purchases: 1 }]);
  });
});

describe("attribution of conversions", () => {
  it("credits the last referrer or campaign visit within 30 days, through linked visitor ids", () => {
    const signupAt = NOW - 2 * DAY;
    const events = [
      ev({ id: "old", name: PAGE_VIEW, itemType: ENTRY_MARK, anonId: "A", referrer: "bing.com", createdAt: iso(signupAt - 40 * DAY) }),
      ev({ id: "t1", name: PAGE_VIEW, itemType: ENTRY_MARK, anonId: "A", referrer: "google.com", createdAt: iso(signupAt - 3 * DAY) }),
      ev({ id: "t2", name: PAGE_VIEW, itemType: ENTRY_MARK, anonId: "A", utm: { source: "ads" }, createdAt: iso(signupAt - DAY) }),
      ev({ id: "later", name: PAGE_VIEW, itemType: ENTRY_MARK, anonId: "A", referrer: "late.com", createdAt: iso(signupAt + DAY) }),
      // Seen together after signing up: links visitor A to member u1.
      ev({ id: "link", name: PAGE_VIEW, anonId: "A", userId: "u1", createdAt: iso(signupAt + 2 * DAY) }),
      ev({ id: "signup", name: SIGN_UP, userId: "u1", createdAt: iso(signupAt) }),
      ev({ id: "buy", name: PURCHASE, userId: "u2", createdAt: iso(signupAt) }),
      ev({ id: "tagged", name: PURCHASE, userId: "u1", referrer: "kept.com", createdAt: iso(signupAt) }),
    ];
    const touches = attributeConversions(events);
    assert.deepEqual(touches.get("signup"), { referrer: undefined, utm: { source: "ads" } });
    assert.equal(touches.has("buy"), false, "no visits for that member");
    assert.equal(touches.has("tagged"), false, "already attributed");
    const applied = withAttribution(events);
    assert.deepEqual(applied.find((e) => e.id === "signup")!.utm, { source: "ads" });
    assert.equal(events.find((e) => e.id === "signup")!.utm, undefined, "input is not mutated");
  });

  it("ignores touches outside the window", () => {
    const events = [ev({ id: "t", name: PAGE_VIEW, itemType: ENTRY_MARK, userId: "u1", referrer: "x.com", createdAt: iso(NOW - 31 * DAY) }), ev({ id: "s", name: SIGN_UP, userId: "u1", createdAt: iso(NOW) })];
    assert.equal(attributeConversions(events).size, 0);
  });
});

describe("rollups", () => {
  const day = "2025-12-01";
  const at = (h: number) => `${day}T${String(h).padStart(2, "0")}:00:00.000Z`;
  const raw = [
    ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, anonId: "A", referrer: "google.com", createdAt: at(1) }),
    ev({ name: PAGE_VIEW, path: "/courses/js", anonId: "A", createdAt: at(2) }),
    ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, referrer: "google.com", createdAt: at(3) }),
    ev({ name: PAGE_VIEW, path: "/", itemType: ENTRY_MARK, createdAt: at(4) }),
    ev({ name: PURCHASE, userId: "u1", itemType: "course", itemId: "c1", value: 4000, currency: "USD", createdAt: at(5) }),
    ev({ name: PURCHASE, userId: "u2", itemType: "course", itemId: "c1", value: 6000, currency: "USD", createdAt: at(6) }),
  ];
  let n = 0;
  const rollups = buildRollups(raw, [], () => `r${++n}`);

  it("keeps no visitor or member ids", () => {
    assert.ok(rollups.every((r) => !r.anonId && !r.userId));
    assert.ok(rollups.every((r) => r.createdAt === `${day}T00:00:00.000Z`));
  });

  it("groups by day and dimensions, with counts, sums and daily visitors", () => {
    const find = (name: string, pred: (r: AnalyticsEvent) => boolean = () => true) => rollups.find((r) => r.name === name && pred(r));
    assert.equal(find("rollup:page_view", (r) => r.path === "/" && r.referrer === "google.com")!.value, 2);
    assert.equal(find("rollup:purchase")!.value, 2);
    assert.equal(find("rollup-sum:purchase")!.value, 10000);
    assert.equal(find(VISITORS_ROLLUP)!.value, 3, "visitor A + two anonymous visits");
  });

  it("keeps every metric the same before and after compaction", () => {
    const before = raw.map(toEventCount);
    const after = rollups.map(toEventCount);
    assert.equal(countVisitors(after), countVisitors(before));
    assert.deepEqual(referrerTable(after), referrerTable(before));
    assert.deepEqual(
      funnelStages(after, 2).map((s) => s.count),
      [3, 1, 0, 2],
    );
  });

  it("adds to existing rollup rows instead of duplicating them", () => {
    const again = buildRollups([raw[3]!], rollups, () => `x${++n}`);
    assert.equal(again.length, rollups.length);
    assert.equal(again.find((r) => r.name === VISITORS_ROLLUP)!.value, 4);
    assert.equal(rollups.find((r) => r.name === VISITORS_ROLLUP)!.value, 3, "existing rows are copied, not mutated");
  });
});

describe("revenue", () => {
  const bounds = { startMs: NOW - 7 * DAY, endMs: NOW + DAY };
  const payments = [
    pay({ amount: 11800, taxAmount: 1800, couponCode: "spring", discountAmount: 2000 }),
    pay({ amount: 5000, itemType: "bundle", itemId: "b1", itemTitle: "Bundle", status: "refunded", refundedAmount: 5000, refundedAt: iso(NOW - 2 * DAY) }),
    pay({ amount: 3000, refundedAmount: 1000, refundedAt: iso(NOW - DAY), couponCode: "SPRING", discountAmount: 500 }),
    pay({ amount: 9000, currency: "EUR" }),
    pay({ amount: 7000, status: "pending", paidAt: undefined }),
    pay({ amount: 4000, paidAt: iso(NOW - 30 * DAY) }),
  ];

  it("summarizes sales excluding tax, refunds, AOV and refund rate per currency", () => {
    const [usd, eur] = summarizeRevenue(payments, bounds);
    assert.deepEqual(usd, { currency: "USD", orders: 3, gross: 18000, tax: 1800, discounts: 2500, refunds: 6000, net: 12000, aov: 6000, refundedOrders: 2, refundRate: 66.7 });
    assert.equal(eur!.net, 9000);
  });

  it("splits revenue by item, best first", () => {
    const rows = revenueByItem(payments, bounds);
    assert.deepEqual(
      rows.map((r) => [r.itemType, r.itemId, r.currency, r.orders, r.net]),
      [
        ["course", "crs_a", "USD", 2, 12000],
        ["course", "crs_a", "EUR", 1, 9000],
        ["bundle", "b1", "USD", 1, 0],
      ],
    );
  });

  it("reports coupons case-insensitively", () => {
    assert.deepEqual(couponPerformance(payments, bounds), [{ code: "SPRING", currency: "USD", orders: 2, discount: 2500, revenue: 12000 }]);
  });

  it("builds a daily net revenue series in major units", () => {
    const days = ["2026-03-18", "2026-03-19"];
    assert.deepEqual(revenueSeries(payments, days, "USD"), [
      { date: "2026-03-18", value: -50 },
      { date: "2026-03-19", value: 170 },
    ]);
  });
});

describe("subscriptions", () => {
  const plans = [
    { id: "m", interval: "month" as const, price: 2000, currency: "USD" },
    { id: "y", interval: "year" as const, price: 12000, currency: "USD" },
    { id: "o", interval: "one_time" as const, price: 50000, currency: "USD" },
  ];

  it("normalizes plan prices to a month", () => {
    assert.equal(monthlyValue(plans[0]!), 2000);
    assert.equal(monthlyValue(plans[1]!), 1000);
    assert.equal(monthlyValue(plans[2]!), 0);
  });

  it("computes MRR from paying subscriptions only", () => {
    const subs = [
      { planId: "m", status: "active" as const, cancelAtPeriodEnd: false },
      { planId: "y", status: "active" as const, cancelAtPeriodEnd: true },
      { planId: "m", status: "trialing" as const, cancelAtPeriodEnd: false },
      { planId: "m", status: "past_due" as const, cancelAtPeriodEnd: false },
      { planId: "m", status: "cancelled" as const, cancelAtPeriodEnd: false },
      { planId: "gone", status: "active" as const, cancelAtPeriodEnd: false },
    ];
    assert.deepEqual(computeMrr(subs, plans), [{ currency: "USD", mrr: 3000, active: 2, trialing: 1, pastDue: 1, atRisk: 2000, cancelling: 1 }]);
  });

  it("counts started and ended subscriptions in a period", () => {
    const bounds = { startMs: NOW - 7 * DAY, endMs: NOW };
    const subs = [
      { status: "active" as const, createdAt: iso(NOW - DAY), updatedAt: iso(NOW - DAY) },
      { status: "cancelled" as const, createdAt: iso(NOW - 90 * DAY), updatedAt: iso(NOW - 2 * DAY) },
      { status: "expired" as const, createdAt: iso(NOW - 90 * DAY), updatedAt: iso(NOW - 20 * DAY) },
    ];
    assert.deepEqual(subscriptionMovement(subs, bounds), { started: 1, ended: 1 });
  });
});

describe("cohort retention", () => {
  it("starts weeks on Monday (UTC)", () => {
    assert.equal(new Date(weekStartMs(Date.parse("2026-03-20T15:00:00Z"))).toISOString(), "2026-03-16T00:00:00.000Z");
    assert.equal(new Date(weekStartMs(Date.parse("2026-03-16T00:00:00Z"))).toISOString(), "2026-03-16T00:00:00.000Z");
  });

  it("shares of each weekly cohort active N weeks after signing up", () => {
    const signup = Date.parse("2026-02-02T10:00:00Z"); // Monday
    const users = [
      { id: "a", createdAt: iso(signup) },
      { id: "b", createdAt: iso(signup + DAY) },
      { id: "c", createdAt: iso(NOW - DAY) },
    ];
    const activity = new Map<string, number[]>([
      ["a", [signup + 8 * DAY, signup + 15 * DAY]],
      ["b", [signup + DAY + 9 * DAY]],
    ]);
    const rows = computeCohorts(users, activity, { nowMs: NOW, cohorts: 8, weeks: 3 });
    assert.equal(rows.length, 8);
    assert.equal(rows[0]!.week, "2026-03-16");
    assert.deepEqual(rows[0], { week: "2026-03-16", size: 1, cells: [null, null, null] });
    const feb = rows.find((r) => r.week === "2026-02-02")!;
    assert.deepEqual(feb, { week: "2026-02-02", size: 2, cells: [100, 50, 0] });
    const empty = rows.find((r) => r.week === "2026-02-09")!;
    assert.deepEqual(empty.cells, [null, null, null]);
  });
});

describe("bot filtering", () => {
  it("drops crawlers, unfurlers, scripts and empty agents but keeps browsers", () => {
    for (const ua of ["Googlebot/2.1 (+http://www.google.com/bot.html)", "facebookexternalhit/1.1", "curl/8.4.0", "python-requests/2.31", "Mozilla/5.0 HeadlessChrome/120", "Slackbot-LinkExpanding 1.0", "", undefined]) {
      assert.equal(isBot(ua), true, String(ua));
    }
    assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"), false);
  });
});
