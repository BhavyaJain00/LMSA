import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalEmail,
  clampCookieDays,
  clampPercent,
  codeFromName,
  commissionBase,
  commissionIneligibility,
  commissionTotals,
  computeCommission,
  formatRefCookie,
  fraudFlags,
  methodLabel,
  normalizeCode,
  paginate,
  parseAffiliateFilter,
  parseCommissionFilter,
  parseRefCookie,
  payableBalances,
  pickLastClick,
  planRefund,
  rate,
  sanitizeLandingPath,
  shareUrl,
  uniqueCode,
  withinWindow,
} from "@/lib/growth/affiliates-shared";
import { isBot } from "@/lib/growth/bots";

/** Growth, item 1 (affiliates): pure attribution, commission, refund and fraud rules. */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-06-15T12:00:00.000Z");

describe("affiliate codes", () => {
  it("normalizes well-formed codes and rejects the rest", () => {
    assert.equal(normalizeCode(" ada-99 "), "ADA-99");
    assert.equal(normalizeCode("x_y_z"), "X_Y_Z");
    for (const bad of ["ab", "-abc", "a b c", "a".repeat(33), "<script>", "", null, 42]) assert.equal(normalizeCode(bad), null, String(bad));
  });

  it("derives codes from names and keeps them unique", () => {
    assert.equal(codeFromName("Ada Lovelace"), "ADALOVELACE");
    assert.equal(codeFromName("Zoë"), "ZOE");
    assert.equal(codeFromName("Al"), "REFAL");
    assert.equal(codeFromName("李"), "REF");
    assert.equal(uniqueCode("ada", ["BOB"]), "ADA");
    const second = uniqueCode("ada", ["ada"], () => 0.5);
    assert.match(second, /^ADA\d{2,3}$/);
    assert.notEqual(second, "ADA");
    // When every random suffix is taken it still finds a free code.
    const taken = ["ADA", ...Array.from({ length: 990 }, (_, i) => `ADA${10 + i}`)];
    assert.equal(uniqueCode("ada", taken, () => 0), "ADA1000");
  });
});

describe("referral cookie and attribution window", () => {
  it("round-trips the cookie and rejects malformed or future values", () => {
    const value = formatRefCookie("ADA", NOW);
    assert.equal(value, `ADA.${NOW / 1000}`);
    assert.deepEqual(parseRefCookie(value, NOW), { code: "ADA", at: NOW });
    assert.deepEqual(parseRefCookie("ada.1700000000", NOW), { code: "ADA", at: 1_700_000_000_000 });
    for (const bad of [undefined, "", "ADA", ".123", "ADA.abc", "ADA.-5", "A.123", "ADA.1.5"]) assert.equal(parseRefCookie(bad, NOW), null, String(bad));
    assert.equal(parseRefCookie(formatRefCookie("ADA", NOW + DAY), NOW), null, "a click in the future is ignored");
  });

  it("counts a click inside the window only", () => {
    assert.ok(withinWindow(NOW - 30 * DAY, NOW, 30));
    assert.ok(!withinWindow(NOW - 30 * DAY - 1, NOW, 30));
    assert.ok(withinWindow(NOW, NOW, 1));
    assert.ok(!withinWindow(NOW + DAY, NOW, 30), "future clicks never attribute");
    assert.ok(!withinWindow(Number.NaN, NOW, 30));
  });

  it("clamps the configured window to 1–365 days", () => {
    assert.equal(clampCookieDays(0), 1);
    assert.equal(clampCookieDays(1000), 365);
    assert.equal(clampCookieDays("abc"), 30);
    assert.equal(clampCookieDays(14.4), 14);
  });

  it("credits the last click inside the window", () => {
    const clicks = [
      { id: "old", at: NOW - 40 * DAY },
      { id: "first", at: NOW - 20 * DAY },
      { id: "last", at: NOW - 2 * DAY },
      { id: "future", at: NOW + 2 * DAY },
    ];
    assert.equal(pickLastClick(clicks, NOW, 30)?.id, "last");
    assert.equal(pickLastClick(clicks, NOW, 1), null, "nothing inside a 1-day window");
    assert.equal(pickLastClick(clicks.slice(0, 2), NOW, 30)?.id, "first", "an expired later click never wins");
    assert.equal(pickLastClick([], NOW, 30), null);
  });
});

describe("commission math", () => {
  it("uses the net, tax-exclusive amount", () => {
    assert.equal(commissionBase({ amount: 11800, taxAmount: 1800 }), 10000);
    assert.equal(commissionBase({ amount: 5000, taxAmount: 0 }), 5000);
    assert.equal(commissionBase({ amount: 100, taxAmount: 500 }), 0);
  });

  it("rounds to the nearest unit and clamps the rate", () => {
    assert.equal(computeCommission(10000, 20), 2000);
    assert.equal(computeCommission(999, 12.5), 125);
    assert.equal(computeCommission(10000, 150), 10000);
    assert.equal(computeCommission(10000, -5), 0);
    assert.equal(computeCommission(0, 20), 0);
    assert.equal(clampPercent("12.345"), 12.35);
    assert.equal(clampPercent("nope", 20), 20);
  });

  it("refuses self-referrals, inactive affiliates, duplicates and empty orders", () => {
    const base = { enabled: true, buyerId: "buyer", base: 5000, percent: 20, alreadyCredited: false };
    const active = { userId: "aff-user", status: "active" as const };
    assert.equal(commissionIneligibility({ ...base, affiliate: active }), null);
    assert.equal(commissionIneligibility({ ...base, affiliate: { ...active, userId: "buyer" } }), "self_referral");
    assert.equal(commissionIneligibility({ ...base, affiliate: { ...active, status: "paused" } }), "inactive");
    assert.equal(commissionIneligibility({ ...base, affiliate: { ...active, status: "pending" } }), "inactive");
    assert.equal(commissionIneligibility({ ...base, affiliate: null }), "no_affiliate");
    assert.equal(commissionIneligibility({ ...base, affiliate: active, enabled: false }), "disabled");
    assert.equal(commissionIneligibility({ ...base, affiliate: active, alreadyCredited: true }), "exists");
    assert.equal(commissionIneligibility({ ...base, affiliate: active, base: 0 }), "zero_amount");
    assert.equal(commissionIneligibility({ ...base, affiliate: active, percent: 0 }), "zero_amount");
  });
});

describe("refunds", () => {
  const original = (status: "pending" | "approved" | "paid" | "void", amount = 2000) => ({ id: "c1", amount, status, createdAt: "2026-06-01T00:00:00.000Z" });

  it("voids an unpaid commission on a full refund", () => {
    assert.deepEqual(planRefund([original("pending")], { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: ["c1"], adjustment: null });
    assert.deepEqual(planRefund([original("approved")], { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: ["c1"], adjustment: null });
  });

  it("reduces an unpaid commission pro rata on a partial refund", () => {
    const plan = planRefund([original("pending")], { amount: 10000, refundedAmount: 2500, full: false });
    assert.deepEqual(plan, { voidIds: [], adjustment: { amount: -500, status: "pending" } });
    const approved = planRefund([original("approved")], { amount: 10000, refundedAmount: 2500, full: false });
    assert.deepEqual(approved.adjustment, { amount: -500, status: "approved" });
  });

  it("claws back a paid commission against the next payout", () => {
    assert.deepEqual(planRefund([original("paid")], { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: [], adjustment: { amount: -2000, status: "approved" } });
  });

  it("is idempotent and handles a second partial refund", () => {
    const rows = [original("pending"), { id: "c2", amount: -500, status: "pending" as const, createdAt: "2026-06-02T00:00:00.000Z" }];
    assert.deepEqual(planRefund(rows, { amount: 10000, refundedAmount: 2500, full: false }), { voidIds: [], adjustment: null }, "same refund again: no change");
    assert.deepEqual(planRefund(rows, { amount: 10000, refundedAmount: 5000, full: false }).adjustment, { amount: -500, status: "pending" });
    assert.deepEqual(planRefund(rows, { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: ["c1", "c2"], adjustment: null }, "the rest is refunded: void everything unpaid");
  });

  it("does nothing for a voided or missing commission", () => {
    assert.deepEqual(planRefund([original("void")], { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: [], adjustment: null });
    assert.deepEqual(planRefund([], { amount: 10000, refundedAmount: 10000, full: true }), { voidIds: [], adjustment: null });
  });
});

describe("totals", () => {
  it("sums by status and currency, netting corrections", () => {
    const rows = [
      { amount: 2000, currency: "USD", status: "approved" as const },
      { amount: -500, currency: "USD", status: "approved" as const },
      { amount: 1000, currency: "USD", status: "pending" as const },
      { amount: 3000, currency: "USD", status: "paid" as const },
      { amount: 700, currency: "EUR", status: "void" as const },
      { amount: 900, currency: "EUR", status: "approved" as const },
    ];
    assert.deepEqual(commissionTotals(rows), [
      { currency: "EUR", pending: 0, approved: 900, paid: 0, voided: 700 },
      { currency: "USD", pending: 1000, approved: 1500, paid: 3000, voided: 0 },
    ]);
    assert.deepEqual(payableBalances(rows), [
      { currency: "EUR", amount: 900 },
      { currency: "USD", amount: 1500 },
    ]);
    assert.equal(rate(3, 40), 7.5);
    assert.equal(rate(1, 0), 0);
  });
});

describe("fraud flags", () => {
  it("canonicalizes mailboxes", () => {
    assert.equal(canonicalEmail(" Ada.Love+promo@GoogleMail.com "), "adalove@gmail.com");
    assert.equal(canonicalEmail("a.b+x@example.com"), "a.b@example.com");
    assert.equal(canonicalEmail(undefined), "");
  });

  it("flags a shared sign-in IP and a matching email", () => {
    const affiliateIps = new Set(["203.0.113.5", "198.51.100.7"]);
    assert.deepEqual(fraudFlags({ buyerEmail: "buyer@example.com", buyerIps: ["192.0.2.1"], affiliateEmails: ["aff@example.com"], affiliateIps }), []);
    assert.deepEqual(fraudFlags({ buyerEmail: "buyer@example.com", buyerIps: ["198.51.100.7"], affiliateEmails: ["aff@example.com"], affiliateIps }), ["shared_ip"]);
    assert.deepEqual(
      fraudFlags({ buyerEmail: "a.ff+2@gmail.com", buyerIps: ["203.0.113.5"], affiliateEmails: ["someone@x.test", "aff@gmail.com"], affiliateIps }),
      ["shared_ip", "same_email"],
    );
    assert.deepEqual(fraudFlags({ buyerIps: ["unknown"], affiliateEmails: [undefined], affiliateIps: new Set(["unknown"]) }), [], "unknown IPs never match");
  });
});

describe("links, filters and pagination", () => {
  it("builds share links on the site origin", () => {
    assert.equal(shareUrl("https://learn.example", "/courses/js?utm_source=x&ref=OLD", "ADA"), "https://learn.example/courses/js?utm_source=x&ref=ADA");
    assert.equal(shareUrl("https://learn.example", "pricing", "ADA"), "https://learn.example/pricing?ref=ADA");
  });

  it("keeps landing paths local and bounded", () => {
    assert.equal(sanitizeLandingPath("/courses/js"), "/courses/js");
    assert.equal(sanitizeLandingPath("//evil.test/x"), "/");
    assert.equal(sanitizeLandingPath("https://evil.test"), "/");
    assert.equal(sanitizeLandingPath(null), "/");
    assert.equal(sanitizeLandingPath(`/${"a".repeat(400)}`).length, 300);
  });

  it("parses admin filters defensively", () => {
    assert.deepEqual(parseAffiliateFilter({ status: "pending", q: "  ada ", flagged: "1", page: "3" }), { status: "pending", q: "ada", flagged: true, page: 3 });
    assert.deepEqual(parseAffiliateFilter({ status: "bogus", page: "-2" }), { status: "all", q: "", flagged: false, page: 1 });
    const c = parseCommissionFilter(new URLSearchParams("status=paid&from=2026-01-01&to=nope&affiliate=aff_1&page=x"));
    assert.deepEqual(c, { status: "paid", affiliateId: "aff_1", q: "", flagged: false, from: "2026-01-01", to: "", page: 1 });
    assert.equal(parseCommissionFilter({ affiliate: "../../etc" }).affiliateId, "");
  });

  it("paginates and clamps the page", () => {
    const rows = Array.from({ length: 53 }, (_, i) => i);
    assert.deepEqual(paginate(rows, 3, 25), { rows: [50, 51, 52], page: 3, pageCount: 3, total: 53 });
    assert.equal(paginate(rows, 99, 25).page, 3);
    assert.deepEqual(paginate([], 1, 25), { rows: [], page: 1, pageCount: 1, total: 0 });
  });

  it("labels payout methods", () => {
    assert.equal(methodLabel("paypal"), "PayPal");
    assert.equal(methodLabel("cheque"), "cheque");
  });
});

describe("bot filtering", () => {
  it("drops crawlers, unfurlers, scripts and empty user agents", () => {
    for (const ua of [
      "",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0",
      "curl/8.4.0",
      "python-requests/2.31",
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0 Safari/537.36",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.0; +https://openai.com/gptbot)",
    ]) {
      assert.ok(isBot(ua), ua);
    }
  });

  it("keeps real browsers", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
    ]) {
      assert.ok(!isBot(ua), ua);
    }
  });
});
