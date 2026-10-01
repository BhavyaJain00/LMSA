import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Earning } from "@/lib/types";
import {
  allocateToCourses,
  earningTotals,
  earningsByCourse,
  earningsByMonth,
  earningsToCsv,
  filterEarningRows,
  largestRemainder,
  orderNet,
  parseApplication,
  parseEarningFilter,
  parseExpertise,
  parseSharePercent,
  payoutsToCsv,
  pendingBalances,
  planEarningRefund,
  serializeApplication,
  splitCourseRevenue,
  validateApplication,
  type EarningRowView,
} from "@/lib/teaching/marketplace-shared";

const sum = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

function earning(overrides: Partial<Earning>): Earning {
  return {
    id: "earn_1",
    instructorId: "usr_a",
    paymentId: "pay_1",
    courseId: "crs_1",
    gross: 10000,
    share: 7000,
    currency: "USD",
    status: "pending",
    createdAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

describe("teaching-tools revenue split: largest remainder", () => {
  it("always adds up to the total", () => {
    assert.deepEqual(largestRemainder(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(largestRemainder(10, [1, 2]), [3, 7]);
    for (const total of [0, 1, 7, 99, 1001, 123457]) {
      for (const weights of [[1], [1, 1], [3, 5, 7], [0.1, 0.2, 0.7], [1999, 0, 4999]]) {
        const parts = largestRemainder(total, weights);
        assert.equal(sum(parts), total, `${total} over ${weights.join("/")}`);
        assert.ok(parts.every((p) => Number.isInteger(p) && p >= 0));
      }
    }
  });

  it("splits evenly when every weight is zero and handles no parts", () => {
    assert.deepEqual(largestRemainder(10, [0, 0]), [5, 5]);
    assert.deepEqual(largestRemainder(10, []), []);
    assert.deepEqual(largestRemainder(-5, [1, 1]), [0, 0]);
  });
});

describe("teaching-tools revenue split: order and course amounts", () => {
  it("nets out tax but not twice the discount", () => {
    // amount is already after the discount: 100.00 - 20.00 + 8.00 tax
    assert.equal(orderNet({ amount: 8800, taxAmount: 800 }), 8000);
    assert.equal(orderNet({ amount: 500, taxAmount: 900 }), 0);
  });

  it("allocates a bundle by course list price, cent exact", () => {
    const parts = allocateToCourses(10001, [
      { id: "a", weight: 3000 },
      { id: "b", weight: 6000 },
      { id: "c", weight: 0 },
    ]);
    assert.deepEqual(parts, [
      { courseId: "a", amount: 3334 },
      { courseId: "b", amount: 6667 },
      { courseId: "c", amount: 0 },
    ]);
    assert.equal(sum(allocateToCourses(999, [{ id: "a", weight: 0 }, { id: "b", weight: 0 }, { id: "c", weight: 0 }]).map((p) => p.amount)), 999);
  });

  it("gives a single instructor exactly their share", () => {
    assert.deepEqual(splitCourseRevenue(10000, [{ instructorId: "a", percent: 70 }]), [{ instructorId: "a", amount: 7000 }]);
    assert.deepEqual(splitCourseRevenue(999, [{ instructorId: "a", percent: 70 }]), [{ instructorId: "a", amount: 699 }]); // 699.3
    assert.deepEqual(splitCourseRevenue(1001, [{ instructorId: "a", percent: 50 }]), [{ instructorId: "a", amount: 501 }]); // 500.5 rounds half up
  });

  it("splits a course evenly among co-instructors by their share, rounding once", () => {
    const split = splitCourseRevenue(1000, [
      { instructorId: "a", percent: 70 },
      { instructorId: "b", percent: 70 },
      { instructorId: "c", percent: 70 },
    ]);
    // exact 233.33 each -> 700 in total, never 699 or 701
    assert.equal(sum(split.map((s) => s.amount)), 700);
    assert.deepEqual(
      split.map((s) => s.amount),
      [234, 233, 233],
    );
    const mixed = splitCourseRevenue(9999, [
      { instructorId: "a", percent: 80 },
      { instructorId: "b", percent: 50 },
    ]);
    assert.equal(sum(mixed.map((s) => s.amount)), Math.round(9999 * 0.4 + 9999 * 0.25));
    assert.ok(mixed[0].amount > mixed[1].amount);
  });

  it("never pays more than the net and drops zero amounts and duplicates", () => {
    for (const net of [1, 3, 17, 1234, 99999]) {
      const split = splitCourseRevenue(net, [
        { instructorId: "a", percent: 100 },
        { instructorId: "b", percent: 100 },
        { instructorId: "c", percent: 100 },
      ]);
      assert.ok(sum(split.map((s) => s.amount)) <= net);
    }
    assert.deepEqual(splitCourseRevenue(1, [{ instructorId: "a", percent: 10 }]), []);
    assert.deepEqual(splitCourseRevenue(0, [{ instructorId: "a", percent: 70 }]), []);
    assert.deepEqual(splitCourseRevenue(100, []), []);
    assert.deepEqual(splitCourseRevenue(100, [{ instructorId: "a", percent: 50 }, { instructorId: "a", percent: 90 }]), [{ instructorId: "a", amount: 50 }]);
    assert.deepEqual(splitCourseRevenue(100, [{ instructorId: "a", percent: 150 }]), [{ instructorId: "a", amount: 100 }]);
  });
});

describe("teaching-tools revenue split: refunds", () => {
  const order = { amount: 10000, refundedAmount: 10000, full: true };

  it("voids unpaid earnings of a full refund", () => {
    assert.deepEqual(planEarningRefund([earning({ id: "e1" })], order), { voidIds: ["e1"], adjustment: null });
  });

  it("claws back paid earnings with a negative correction", () => {
    assert.deepEqual(planEarningRefund([earning({ id: "e1", status: "paid" })], order), { voidIds: [], adjustment: -7000 });
  });

  it("reduces in proportion to a partial refund and is idempotent", () => {
    const partial = { amount: 10000, refundedAmount: 2500, full: false };
    const plan = planEarningRefund([earning({ id: "e1" })], partial);
    assert.deepEqual(plan, { voidIds: [], adjustment: -1750 });
    const after = [earning({ id: "e1" }), earning({ id: "e2", share: -1750, createdAt: "2026-09-11T00:00:00.000Z" })];
    assert.deepEqual(planEarningRefund(after, partial), { voidIds: [], adjustment: null });
    // then the rest is refunded: everything unpaid is voided
    assert.deepEqual(planEarningRefund(after, order), { voidIds: ["e1", "e2"], adjustment: null });
  });

  it("does nothing for void or missing originals", () => {
    assert.deepEqual(planEarningRefund([earning({ status: "void" })], order), { voidIds: [], adjustment: null });
    assert.deepEqual(planEarningRefund([], order), { voidIds: [], adjustment: null });
  });
});

describe("teaching-tools revenue split: reports", () => {
  const rows = [
    earning({ id: "e1", share: 7000, gross: 10000 }),
    earning({ id: "e2", share: 3500, gross: 5000, status: "paid", courseId: "crs_2", createdAt: "2026-08-02T00:00:00.000Z" }),
    earning({ id: "e3", share: -700, gross: 0 }),
    earning({ id: "e4", share: 1000, status: "void" }),
    earning({ id: "e5", share: 900, currency: "EUR" }),
  ];

  it("totals per currency with corrections netted into the unpaid balance", () => {
    assert.deepEqual(earningTotals(rows), [
      { currency: "EUR", pending: 900, paid: 0, voided: 0 },
      { currency: "USD", pending: 6300, paid: 3500, voided: 1000 },
    ]);
    assert.deepEqual(pendingBalances(rows), [
      { currency: "EUR", amount: 900 },
      { currency: "USD", amount: 6300 },
    ]);
  });

  it("groups by course and by month", () => {
    const byCourse = earningsByCourse(rows);
    const c1 = byCourse.find((c) => c.courseId === "crs_1" && c.currency === "USD");
    assert.deepEqual(c1, { courseId: "crs_1", currency: "USD", sales: 1, gross: 10000, pending: 6300, paid: 0 });
    const byMonth = earningsByMonth(rows);
    assert.equal(byMonth[0].month, "2026-09");
    assert.deepEqual(
      byMonth.find((m) => m.month === "2026-09" && m.currency === "USD"),
      { month: "2026-09", currency: "USD", sales: 1, earned: 6300 },
    );
    assert.deepEqual(byMonth.find((m) => m.month === "2026-08"), { month: "2026-08", currency: "USD", sales: 1, earned: 3500 });
  });

  it("filters rows and writes formula-safe CSV", () => {
    const views: EarningRowView[] = [
      { id: "e1", createdAt: "2026-09-10T10:00:00.000Z", status: "pending", instructorId: "usr_a", instructorName: "=Ada", courseId: "crs_1", courseTitle: "Intro, part 1", orderId: "ORD-1", adjustment: false, gross: 10000, share: 7000, currency: "USD" },
      { id: "e2", createdAt: "2026-08-01T10:00:00.000Z", status: "paid", instructorId: "usr_b", instructorName: "Bob", courseId: "crs_2", courseTitle: "Next", orderId: "ORD-2", adjustment: true, gross: 0, share: -500, currency: "USD", paidAt: "2026-08-05T00:00:00.000Z" },
    ];
    const filter = parseEarningFilter(new URLSearchParams("status=paid&from=2026-08-01&to=2026-08-31&q=next"));
    assert.deepEqual(filterEarningRows(views, filter).map((r) => r.id), ["e2"]);
    assert.deepEqual(filterEarningRows(views, parseEarningFilter({ instructor: "usr_a" })).map((r) => r.id), ["e1"]);
    assert.equal(parseEarningFilter({ from: "not-a-date", course: "../x" }).from, "");
    const csv = earningsToCsv(views, true).split("\r\n");
    assert.match(csv[0], /Instructor share/);
    assert.equal(csv[1], `e1,2026-09-10,Sale,pending,'=Ada,"Intro, part 1",ORD-1,100.00,70.00,USD,`);
    assert.equal(csv[2], "e2,2026-08-01,Refund adjustment,paid,Bob,Next,ORD-2,0.00,-5.00,USD,2026-08-05");
    assert.doesNotMatch(earningsToCsv(views, false), /Instructor share|Bob/);
    const payouts = payoutsToCsv([{ id: "p1", createdAt: "2026-09-01T00:00:00.000Z", instructorId: "usr_a", instructorName: "Ada", payTo: "ada@example.com", amount: 12345, currency: "USD", method: "paypal", earnings: 3 }]);
    assert.equal(payouts.split("\r\n")[1], "p1,2026-09-01,Ada,ada@example.com,123.45,USD,PayPal,,3");
  });
});

describe("teaching-tools revenue split: applications", () => {
  const valid = {
    bio: "I have taught data analysis to adults for eight years, at a bootcamp and at a community college evening program.",
    expertise: "Python, SQL\npython, Data viz",
    sampleUrl: "https://example.com/talk",
    sample: "",
    payoutEmail: " Ada@Example.com ",
  };

  it("validates and normalizes an application", () => {
    const result = validateApplication(valid);
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.deepEqual(result.application.expertise, ["Python", "SQL", "Data viz"]);
    assert.equal(result.payoutEmail, "ada@example.com");
    assert.equal(result.application.sample, undefined);
  });

  it("reports every invalid field", () => {
    const result = validateApplication({ bio: "short", expertise: " , ", sampleUrl: "javascript:alert(1)", sample: "", payoutEmail: "nope" });
    assert.ok(!result.ok);
    if (result.ok) return;
    assert.deepEqual(Object.keys(result.errors).sort(), ["bio", "expertise", "payoutEmail", "sampleUrl"]);
    const noSample = validateApplication({ ...valid, sampleUrl: "" });
    assert.ok(!noSample.ok && !!noSample.errors.sample);
  });

  it("round-trips the stored application and reads plain text", () => {
    const app = { bio: "Bio", expertise: ["A"], sampleUrl: "https://x.test", sample: "Outline" };
    assert.deepEqual(parseApplication(serializeApplication(app)), app);
    assert.deepEqual(parseApplication("Just text"), { bio: "Just text", expertise: [] });
    assert.deepEqual(parseApplication(undefined), { bio: "", expertise: [] });
    assert.deepEqual(parseExpertise("a;b, A"), ["a", "b"]);
  });

  it("parses share percentages", () => {
    assert.equal(parseSharePercent("70"), 70);
    assert.equal(parseSharePercent("33.333"), 33.33);
    assert.equal(parseSharePercent("101"), null);
    assert.equal(parseSharePercent(""), null);
    assert.equal(parseSharePercent("abc"), null);
  });
});
