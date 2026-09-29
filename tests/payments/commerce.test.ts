import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Payment } from "@/lib/types";
import {
  computeOrderSummary,
  couponAppliesTo,
  couponUsesTaken,
  normalizeCouponCode,
  parseTransactionFilter,
  paymentStatusLabel,
  summarizeTransactions,
  toUsdEquivalent,
  transactionsToCsv,
  validateCoupon,
  type BillingItem,
  type TransactionRow,
} from "@/lib/data/commerce";
import { toDateKey } from "@/lib/utils";
import { buildSettings, makeCoupon, makeCourse, makePayment, resetDb, type SettingsPatch } from "../helpers/db";

const course = makeCourse({ id: "crs_py", price: 9999, paidCourse: true });

function item(overrides: Partial<BillingItem> = {}): BillingItem {
  return {
    type: "course",
    id: course.id,
    title: course.title,
    name: course.title,
    description: "",
    amount: 9999,
    currency: "USD",
    href: "/courses/x",
    course,
    batch: null,
    ...overrides,
  };
}

describe("coupons", () => {
  it("normalises codes", () => {
    assert.equal(normalizeCouponCode("  save 10 "), "SAVE10");
    assert.equal(normalizeCouponCode("welcome\t2026"), "WELCOME2026");
  });

  it("checks which items a coupon applies to", () => {
    assert.equal(couponAppliesTo(makeCoupon(), { type: "batch", id: "bat_1" }), true);
    const forCourse = makeCoupon({ applicableItems: [{ type: "course", id: "crs_py" }] });
    assert.equal(couponAppliesTo(forCourse, { type: "course", id: "crs_py" }), true);
    assert.equal(couponAppliesTo(forCourse, { type: "certificate", id: "crs_py" }), true);
    assert.equal(couponAppliesTo(forCourse, { type: "course", id: "crs_other" }), false);
    assert.equal(couponAppliesTo(forCourse, { type: "batch", id: "crs_py" }), false);
    const forBatch = makeCoupon({ applicableItems: [{ type: "batch", id: "bat_1" }] });
    assert.equal(couponAppliesTo(forBatch, { type: "batch", id: "bat_1" }), true);
    assert.equal(couponAppliesTo(forBatch, { type: "course", id: "bat_1" }), false);
  });

  it("counts pending orders as reserved redemptions", () => {
    const coupon = makeCoupon({ id: "cpn_x", redemptionCount: 2 });
    const payments = [
      makePayment({ userId: "a", itemId: "c", couponId: "cpn_x", status: "pending" }),
      makePayment({ userId: "b", itemId: "c", couponId: "cpn_x", status: "failed" }),
      makePayment({ userId: "c", itemId: "c", couponId: "cpn_other", status: "pending" }),
    ];
    assert.equal(couponUsesTaken(coupon, payments), 3);
  });
});

describe("validateCoupon (store)", () => {
  const yesterday = toDateKey(new Date(Date.now() - 86_400_000));
  const tomorrow = toDateKey(new Date(Date.now() + 86_400_000));

  beforeEach(async () => {
    await resetDb({
      courses: [course],
      coupons: [
        makeCoupon({ id: "cpn_ok", code: "SAVE10", expiresOn: tomorrow }),
        makeCoupon({ id: "cpn_off", code: "OFF", enabled: false }),
        makeCoupon({ id: "cpn_old", code: "OLD", expiresOn: yesterday }),
        makeCoupon({ id: "cpn_full", code: "FULL", usageLimit: 2, redemptionCount: 1 }),
        makeCoupon({ id: "cpn_batch", code: "BATCH", applicableItems: [{ type: "batch", id: "bat_1" }] }),
        makeCoupon({ id: "cpn_fixed", code: "FIVE", discountType: "fixed", value: 500 }),
      ],
      payments: [makePayment({ userId: "someone", itemId: course.id, couponId: "cpn_full", status: "pending" })],
      settings: { commerce: { defaultCurrency: "USD" } },
    });
  });

  it("accepts a valid code in any case and spacing", async () => {
    const check = await validateCoupon(" save 10 ", item());
    assert.ok(check.ok);
    assert.equal(check.ok && check.coupon.id, "cpn_ok");
  });

  it("explains why a code cannot be used", async () => {
    const error = async (code: string, target = item()) => {
      const check = await validateCoupon(code, target);
      return check.ok ? null : check.error;
    };
    assert.equal(await error(""), "Please enter a coupon code");
    assert.equal(await error("NOPE"), "The coupon code 'NOPE' is invalid.");
    assert.equal(await error("OFF"), "The coupon code 'OFF' is invalid.");
    assert.equal(await error("OLD"), "This coupon has expired.");
    assert.equal(await error("FULL"), "This coupon has reached its maximum usage limit.");
    assert.equal(await error("BATCH"), "This coupon is not applicable to this Course.");
    assert.equal(await error("FIVE", item({ currency: "INR" })), "This coupon can only be used for prices in USD.");
    assert.equal(await error("FIVE"), null);
  });
});

describe("computeOrderSummary", () => {
  const settings = (commerce: SettingsPatch["commerce"] = {}) => buildSettings({ commerce });

  it("charges the list price without coupon or tax", () => {
    const summary = computeOrderSummary(item(), null, settings());
    assert.deepEqual(
      [summary.originalAmount, summary.discountAmount, summary.subtotal, summary.taxAmount, summary.total, summary.coupon, summary.usdEquivalent],
      [9999, 0, 9999, 0, 9999, null, null],
    );
  });

  it("applies percentage and fixed discounts with rounding and bounds", () => {
    assert.equal(computeOrderSummary(item(), makeCoupon({ value: 25 }), settings()).discountAmount, 2500);
    assert.equal(computeOrderSummary(item(), makeCoupon({ value: 150 }), settings()).total, 0);
    assert.equal(computeOrderSummary(item(), makeCoupon({ value: -10 }), settings()).discountAmount, 0);
    assert.equal(computeOrderSummary(item(), makeCoupon({ discountType: "fixed", value: 500 }), settings()).total, 9499);
    assert.equal(computeOrderSummary(item(), makeCoupon({ discountType: "fixed", value: 50000 }), settings()).total, 0);
    assert.equal(computeOrderSummary(item({ amount: -5 }), null, settings()).total, 0);
  });

  it("adds tax on the discounted subtotal only when enabled", () => {
    const taxed = computeOrderSummary(item(), makeCoupon({ value: 10 }), settings({ applyTax: true, taxPercentage: 18, taxLabel: "GST" }));
    assert.equal(taxed.subtotal, 8999);
    assert.equal(taxed.taxAmount, 1620);
    assert.equal(taxed.total, 10619);
    assert.equal(taxed.taxLabel, "GST");
    assert.equal(computeOrderSummary(item(), null, settings({ applyTax: false, taxPercentage: 18 })).taxAmount, 0);
    assert.equal(computeOrderSummary(item(), null, settings({ applyTax: true, taxPercentage: -5 })).taxAmount, 0);
  });

  it("shows an indicative USD equivalent for other currencies", () => {
    const inr = computeOrderSummary(item({ amount: 499900, currency: "INR" }), null, settings({ showUsdEquivalent: true, applyRounding: true }));
    assert.equal(inr.usdEquivalent, 6000);
    assert.equal(toUsdEquivalent(1000, "EUR", false), 1080);
    assert.equal(toUsdEquivalent(1000, "eur", true), 1100);
    assert.equal(toUsdEquivalent(1000, "USD", true), null);
    assert.equal(toUsdEquivalent(1000, "XYZ", true), null);
  });
});

describe("transaction reporting", () => {
  const rows: Payment[] = [
    makePayment({ userId: "a", itemId: "c", status: "paid", amount: 10000, currency: "USD" }),
    makePayment({ userId: "b", itemId: "c", status: "paid", amount: 5000, currency: "USD", refundedAmount: 1000 }),
    makePayment({ userId: "c", itemId: "c", status: "refunded", amount: 3000, currency: "USD" }),
    makePayment({ userId: "d", itemId: "c", status: "refunded", amount: 4000, currency: "EUR", refundedAmount: 1500 }),
    makePayment({ userId: "e", itemId: "c", status: "pending", amount: 999 }),
    makePayment({ userId: "f", itemId: "c", status: "failed", amount: 999 }),
  ];

  it("labels order states", () => {
    assert.equal(paymentStatusLabel(rows[0]!), "Paid");
    assert.equal(paymentStatusLabel(rows[1]!), "Paid · partially refunded");
    assert.equal(paymentStatusLabel(rows[2]!), "Refunded");
    assert.equal(paymentStatusLabel(rows[3]!), "Partially refunded");
    assert.equal(paymentStatusLabel(rows[4]!), "Awaiting payment");
    assert.equal(paymentStatusLabel(rows[5]!), "Cancelled");
    assert.equal(paymentStatusLabel({ ...rows[5]!, failureReason: "Card declined" }), "Payment failed");
  });

  it("summarises revenue net of refunds per currency", () => {
    assert.deepEqual(summarizeTransactions(rows), {
      paidCount: 2,
      pendingCount: 1,
      refundedCount: 2,
      failedCount: 1,
      revenue: [
        { currency: "USD", amount: 14000 },
        { currency: "EUR", amount: 2500 },
      ],
      refunded: [
        { currency: "USD", amount: 4000 },
        { currency: "EUR", amount: 1500 },
      ],
    });
    assert.deepEqual(summarizeTransactions([]).revenue, []);
  });

  it("parses filters from search params", () => {
    assert.deepEqual(parseTransactionFilter(new URLSearchParams("status=paid&type=batch&from=2026-01-01&to=bad&search=%20ada%20")), {
      status: "paid",
      type: "batch",
      from: "2026-01-01",
      to: undefined,
      search: "ada",
    });
    assert.deepEqual(parseTransactionFilter({ status: "hacked", type: ["course"] }), { status: "all", type: "all", from: undefined, to: undefined, search: undefined });
  });

  it("exports CSV that spreadsheets cannot execute", () => {
    const row = (overrides: Partial<TransactionRow>): TransactionRow => ({
      ...makePayment({ userId: "a", itemId: "c" }),
      userName: "Ada",
      userEmail: "ada@example.com",
      username: "ada",
      itemHref: null,
      ...overrides,
    });
    const csv = transactionsToCsv([
      row({ orderId: "ORD-1", billingName: '=HYPERLINK("http://evil","click")', itemTitle: "Intro, part 1", amount: 12345, originalAmount: 12345, status: "paid" }),
      row({ orderId: "ORD-2", billingName: "+1 555", userName: "-Bob", userEmail: "@bob", itemTitle: 'Say "hi"\nnow', status: "pending" }),
    ]);
    assert.ok(csv.endsWith("\r\n"));
    const lines = csv.split("\r\n");
    assert.ok(lines[0]!.startsWith("Order ID,Created at,Status,Billing name"));
    assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`));
    assert.ok(csv.includes('"Intro, part 1"'));
    assert.ok(csv.includes(",123.45,"));
    assert.ok(csv.includes(",'+1 555,'-Bob,'@bob,"));
    assert.ok(csv.includes('"Say ""hi""\nnow"'));
  });
});
