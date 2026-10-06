import { after, before, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import type { Payment, Upsell } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { stripeEnv } from "@/lib/server-env";
import { settleEvents } from "@/lib/events";
import { createSession } from "@/lib/auth/session";
import { fulfillPayment, markPaymentFailed } from "@/lib/payments/fulfillment";
import { getBillingItem, insertPendingOrder } from "@/lib/data/commerce";
import {
  allocateGroupRefund,
  bumpOrderId,
  bumpsOf,
  chargeAmount,
  discountedPrice,
  isOrderBump,
  parseItemRef,
  upsellFor,
  upsellPerformance,
  validateUpsellInput,
} from "@/lib/commerce/upsells";
import { getAdminUpsells, orderBumpFor, parseAdminUpsellFilter, postPurchaseOfferFor, upsellsToCsv } from "@/lib/commerce/upsell-service";
import { acceptUpsellAction, saveUpsellAction, upsellsAction } from "@/lib/actions/upsells";
import { placeOrderAction } from "@/lib/actions/payments";
import { makeCourse, makeEnrollment, makePayment, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

/**
 * Upsells: the pure rules (price, offer choice, form, order bump rows,
 * performance, splitting a shared gateway refund), the order bump at
 * checkout charged and settled with its main order, the one-click offer
 * after a purchase, and the admin actions and read models.
 */

const DAY = 86_400_000;
const at = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const up = (over: Partial<Upsell> = {}): Upsell => ({
  id: "ups_1",
  triggerItemType: "course",
  triggerItemId: "crs_a",
  offerItemType: "course",
  offerItemId: "crs_b",
  discountPercent: 25,
  headline: "Add the advanced course",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("upsell rules", () => {
  it("prices the offer at the discount, rounded and clamped", () => {
    assert.equal(discountedPrice(4000, 25), 3000);
    assert.equal(discountedPrice(999, 33), 669);
    assert.equal(discountedPrice(1000, 150), 0);
    assert.equal(discountedPrice(1000, -5), 1000);
  });

  it("offers the oldest active upsell of the trigger item", () => {
    const list = [up({ id: "new", createdAt: "2026-03-01T00:00:00Z" }), up({ id: "old", createdAt: "2026-02-01T00:00:00Z" }), up({ id: "paused", active: false, createdAt: "2025-01-01T00:00:00Z" })];
    assert.equal(upsellFor(list, { type: "course", id: "crs_a" })?.id, "old");
    assert.equal(upsellFor(list, { type: "bundle", id: "crs_a" }), null);
  });

  it("parses item references", () => {
    assert.deepEqual(parseItemRef("bundle:bnd_1"), { type: "bundle", id: "bnd_1" });
    assert.equal(parseItemRef("plan:pln_1"), null);
    assert.equal(parseItemRef("course:"), null);
  });

  it("validates the admin form", () => {
    const ctx = { exists: () => true, duplicateOf: () => null };
    const ok = validateUpsellInput({ trigger: "course:a", offer: "bundle:b", discountPercent: "30", headline: "  Save   more ", active: true }, ctx);
    assert.deepEqual(ok, { ok: true, value: { triggerItemType: "course", triggerItemId: "a", offerItemType: "bundle", offerItemId: "b", discountPercent: 30, headline: "Save more", active: true } });
    const same = validateUpsellInput({ trigger: "course:a", offer: "course:a", discountPercent: "10", headline: "Headline", active: true }, ctx);
    assert.ok(!same.ok && same.errors.offer);
    const bad = validateUpsellInput({ trigger: "", offer: "course:x", discountPercent: "12.5", headline: "x", active: false }, { exists: () => false, duplicateOf: () => null });
    assert.ok(!bad.ok && bad.errors.trigger && bad.errors.offer && bad.errors.discountPercent && bad.errors.headline);
    const dup = validateUpsellInput({ trigger: "course:a", offer: "course:b", discountPercent: "", headline: "Again", active: true }, { exists: () => true, duplicateOf: () => "ups_9" });
    assert.ok(!dup.ok && /already exists/.test(dup.errors.offer ?? ""));
  });

  it("recognises order bump rows and adds them to the charge", () => {
    const main = { id: "pay_main", orderId: "ORD-AB12-CD34", upsellOfPaymentId: undefined, amount: 5000, status: "pending" as const };
    const bump = { id: "pay_bump", orderId: bumpOrderId(main.orderId), upsellOfPaymentId: "pay_main", amount: 3000, status: "pending" as const };
    const later = { id: "pay_later", orderId: "ORD-ZZ99-YY88", upsellOfPaymentId: "pay_main", amount: 2000, status: "paid" as const };
    assert.equal(bump.orderId, "ORD-AB12-CD34-B");
    assert.equal(isOrderBump(bump), true);
    assert.equal(isOrderBump(later), false);
    assert.deepEqual(
      bumpsOf([main, bump, later], main).map((p) => p.id),
      ["pay_bump"],
    );
    assert.equal(chargeAmount([main, bump, later], main), 8000);
    assert.equal(chargeAmount([main, { ...bump, status: "failed" as const }], main), 5000);
  });

  it("measures conversion and revenue per upsell", () => {
    const rows = [
      { id: "m1", orderId: "O1", itemType: "course" as const, itemId: "crs_a", status: "paid" as const, amount: 5000, currency: "USD" },
      { id: "m2", orderId: "O2", itemType: "course" as const, itemId: "crs_a", status: "paid" as const, amount: 5000, currency: "USD" },
      { id: "b1", orderId: "O1-B", itemType: "course" as const, itemId: "crs_b", status: "paid" as const, amount: 3000, currency: "USD", upsellOfPaymentId: "m1" },
      { id: "p2", orderId: "O3", itemType: "course" as const, itemId: "crs_b", status: "refunded" as const, amount: 3000, refundedAmount: 1000, currency: "USD", upsellOfPaymentId: "m2" },
      { id: "x", orderId: "O4", itemType: "course" as const, itemId: "crs_b", status: "paid" as const, amount: 4000, currency: "USD" },
    ];
    const perf = upsellPerformance(up(), rows);
    assert.deepEqual(perf, { triggerSales: 2, accepted: 1, bumps: 1, postPurchase: 0, revenue: { USD: 5000 }, conversionPercent: 50 });
  });

  it("splits a refund on a shared payment between the order and its bumps", () => {
    const rows = [
      { id: "main", amount: 5000, refundedAmount: 0, main: true },
      { id: "bump", amount: 3000, refundedAmount: 3000, main: false },
    ];
    assert.deepEqual([...allocateGroupRefund(rows, 3000, false)], [["bump", 3000], ["main", 0]]);
    assert.deepEqual([...allocateGroupRefund(rows, 5000, false)], [["bump", 3000], ["main", 2000]]);
    assert.deepEqual([...allocateGroupRefund([{ ...rows[0]! }, { ...rows[1]!, refundedAmount: 0 }], 6000, false)], [["bump", 1000], ["main", 5000]]);
    assert.deepEqual([...allocateGroupRefund(rows, 10, true)], [["main", 5000], ["bump", 3000]]);
  });
});

/* ------------------------------------------------------------------ */
/* Checkout and offers                                                 */
/* ------------------------------------------------------------------ */

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const a = makeCourse({ id: "crs_a", slug: "a", title: "Basics", paidCourse: true, price: 5000, currency: "USD" });
const b = makeCourse({ id: "crs_b", slug: "b", title: "Advanced", paidCourse: true, price: 4000, currency: "USD" });
const inr = makeCourse({ id: "crs_inr", slug: "inr", title: "Rupee course", paidCourse: true, price: 400000, currency: "INR" });

async function setup(fixture: { upsells?: Upsell[]; payments?: Payment[]; enrollments?: ReturnType<typeof makeEnrollment>[]; gateway?: "manual" | "none" | "stripe" } = {}) {
  await resetDb({
    users: [buyer, admin],
    courses: [a, b, inr],
    upsells: fixture.upsells ?? [up()],
    payments: fixture.payments ?? [],
    enrollments: fixture.enrollments ?? [],
    settings: { email: { enabled: false }, gamification: { enabled: false }, commerce: { paymentGateway: fixture.gateway ?? "manual" } },
  });
  resetRequest();
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const billing = { billingName: "Bea Buyer", line1: "1 Main Street", city: "Lisbon", country: "Portugal", source: "Search engine", consent: "on" };

before(() => {
  mock.method(console, "info", () => undefined);
  mock.method(console, "warn", () => undefined);
});
after(() => mock.restoreAll());

describe("order bump", () => {
  it("is offered only for an offer the buyer can still buy, in the same currency", async () => {
    await setup();
    const item = (await getBillingItem("course", a.id))!;
    const offer = await orderBumpFor(buyer, item);
    assert.ok(offer);
    assert.equal(offer.summary.total, 3000);
    assert.equal(offer.listTotal, 4000);

    await setup({ payments: [makePayment({ id: "pay_b", userId: buyer.id, itemId: b.id, status: "paid", paidAt: at(-1) })], enrollments: [makeEnrollment({ userId: buyer.id, courseId: b.id, paymentId: "pay_b" })] });
    assert.equal(await orderBumpFor(buyer, item), null);

    await setup({ upsells: [up({ offerItemId: inr.id })] });
    assert.equal(await orderBumpFor(buyer, item), null);
  });

  it("is charged with the order and settled with it", async () => {
    await setup();
    const res = await insertPendingOrder(
      makePayment({ id: "pay_main", userId: buyer.id, itemId: a.id, amount: 5000, gateway: "manual" }),
      makePayment({ id: "pay_bump", userId: buyer.id, itemId: b.id, amount: 3000, originalAmount: 4000, discountAmount: 1000, gateway: "manual" }),
    );
    assert.ok(res.ok && res.bump);
    assert.equal(res.bump.orderId, `${res.payment.orderId}-B`);
    assert.equal(res.bump.upsellOfPaymentId, "pay_main");
    let db = await getDb();
    assert.equal(chargeAmount(db.payments, res.payment), 8000);

    const paid = await fulfillPayment("pay_main", "manual_ref", { source: "admin" });
    assert.ok(paid.ok);
    await settleEvents();
    db = await getDb();
    assert.equal(db.payments.find((p) => p.id === "pay_bump")!.status, "paid");
    assert.deepEqual(db.enrollments.filter((e) => e.userId === buyer.id).map((e) => e.courseId).sort(), [a.id, b.id]);
  });

  it("is cancelled with its order", async () => {
    await setup();
    await insertPendingOrder(makePayment({ id: "pay_main", userId: buyer.id, itemId: a.id }), makePayment({ id: "pay_bump", userId: buyer.id, itemId: b.id, amount: 3000 }));
    assert.ok(await markPaymentFailed("pay_main", "Declined"));
    const db = await getDb();
    assert.equal(db.payments.find((p) => p.id === "pay_bump")!.status, "failed");
  });

  it("is placed from the checkout form and re-checked on the server", async () => {
    await setup({ gateway: "none" });
    await createSession(buyer.id);
    const stale = await placeOrderAction(null, form({ itemType: "course", itemId: a.id, expectedTotal: "5000", bump: "ups_other", ...billing }));
    assert.ok(!stale.ok && /no longer available/.test(stale.error));
    const target = await captureRedirect(() => placeOrderAction(null, form({ itemType: "course", itemId: a.id, expectedTotal: "5000", bump: "ups_1", bumpExpected: "3000", ...billing })));
    assert.match(target, /^\/billing\/success\//);
    await settleEvents();
    const db = await getDb();
    const rows = db.payments.filter((p) => p.userId === buyer.id);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((p) => p.status === "paid"));
    const bump = rows.find(isOrderBump)!;
    assert.equal(bump.itemId, b.id);
    assert.equal(bump.amount, 3000);
    assert.equal(bump.discountAmount, 1000);
  });
});

describe("a checkout with an order bump that never reaches the gateway", () => {
  it("drops the add-on with its order, so both can be bought again", async () => {
    const key = stripeEnv.secretKey;
    stripeEnv.secretKey = "sk_test_outage123";
    const outage = mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    try {
      await setup({ gateway: "stripe" });
      await createSession(buyer.id);
      const res = await placeOrderAction(null, form({ itemType: "course", itemId: a.id, expectedTotal: "5000", bump: "ups_1", bumpExpected: "3000", ...billing }));
      assert.ok(!res.ok);
      assert.deepEqual((await getDb()).payments, [], "no orphaned add-on order is left behind");
    } finally {
      outage.mock.restore();
      stripeEnv.secretKey = key;
    }
  });
});

describe("post-purchase offer", () => {
  const paidMain = () => makePayment({ id: "pay_main", userId: buyer.id, itemId: a.id, status: "paid", paidAt: at(0), gateway: "manual" });

  it("is shown on a paid trigger order until it is taken", async () => {
    await setup({ payments: [paidMain()], enrollments: [makeEnrollment({ userId: buyer.id, courseId: a.id, paymentId: "pay_main" })], gateway: "none" });
    const main = (await getDb()).payments[0]!;
    const offer = await postPurchaseOfferFor(buyer, main);
    assert.ok(offer);
    await createSession(buyer.id);
    const res = await acceptUpsellAction(main.orderId);
    assert.ok(res.ok, res.ok ? "" : res.error);
    assert.equal(res.data.kind, "redirect");
    await settleEvents();
    const db = await getDb();
    const order = db.payments.find((p) => p.upsellOfPaymentId === "pay_main")!;
    assert.equal(order.status, "paid");
    assert.equal(order.amount, 3000);
    assert.equal(order.billingName, main.billingName);
    assert.equal(isOrderBump(order), false);
    assert.equal(await postPurchaseOfferFor(buyer, db.payments.find((p) => p.id === "pay_main")!), null);
    assert.ok(!(await acceptUpsellAction(main.orderId)).ok);
  });

  it("is never shown to someone else or on unpaid orders", async () => {
    await setup({ payments: [paidMain(), makePayment({ id: "pay_open", userId: buyer.id, itemId: a.id, status: "pending" })] });
    const db = await getDb();
    assert.equal(await postPurchaseOfferFor(admin, db.payments[0]!), null);
    assert.equal(await postPurchaseOfferFor(buyer, db.payments[1]!), null);
    await createSession(admin.id);
    assert.ok(!(await acceptUpsellAction(db.payments[0]!.orderId)).ok);
  });
});

describe("upsell admin", () => {
  it("is for administrators only", async () => {
    await setup();
    await createSession(buyer.id);
    assert.ok(!(await saveUpsellAction(null, form({ trigger: "course:crs_a", offer: "course:crs_b", discountPercent: "10", headline: "Hello" }))).ok);
    assert.ok(!(await upsellsAction(["ups_1"], "pause")).ok);
  });

  it("creates, edits, pauses and deletes upsells", async () => {
    await setup({ upsells: [] });
    await createSession(admin.id);
    const created = await saveUpsellAction(null, form({ trigger: "course:crs_b", offer: "course:crs_a", discountPercent: "15", headline: "Go back to basics", active: "on" }));
    assert.ok(created.ok, created.ok ? "" : created.error);
    const dup = await saveUpsellAction(null, form({ trigger: "course:crs_b", offer: "course:crs_a", discountPercent: "5", headline: "Again" }));
    assert.ok(!dup.ok);
    const id = created.data.id;
    const edited = await saveUpsellAction(null, form({ id, trigger: "course:crs_b", offer: "course:crs_a", discountPercent: "20", headline: "Go back to basics" }));
    assert.ok(edited.ok);
    let row = (await getDb()).upsells[0]!;
    assert.equal(row.discountPercent, 20);
    assert.equal(row.active, false);
    assert.ok((await upsellsAction([id], "activate")).ok);
    row = (await getDb()).upsells[0]!;
    assert.equal(row.active, true);
    assert.ok((await upsellsAction([id], "delete")).ok);
    assert.equal((await getDb()).upsells.length, 0);
  });

  it("lists upsells with their results and exports them", async () => {
    await setup({
      upsells: [up(), up({ id: "ups_2", headline: "Rupees", offerItemId: inr.id, active: false, createdAt: "2026-02-01T00:00:00Z" })],
      payments: [
        makePayment({ id: "m1", orderId: "ORD-M1", userId: buyer.id, itemId: a.id, status: "paid", paidAt: at(-1) }),
        makePayment({ id: "b1", orderId: "ORD-M1-B", userId: buyer.id, itemId: b.id, amount: 3000, status: "paid", paidAt: at(-1), upsellOfPaymentId: "m1" }),
      ],
    });
    const filter = parseAdminUpsellFilter(new URLSearchParams("status=active&q=advanced&page=2"));
    assert.deepEqual(filter, { status: "active", search: "advanced", page: 2 });
    const res = await getAdminUpsells(filter);
    assert.deepEqual(
      res.rows.map((r) => r.id),
      ["ups_1"],
    );
    assert.equal(res.page, 1);
    const row = res.rows[0]!;
    assert.equal(row.offerDiscounted, 3000);
    assert.equal(row.performance.accepted, 1);
    assert.equal(row.performance.conversionPercent, 100);
    assert.deepEqual(res.stats, { total: 2, active: 1, accepted: 1, revenue: [{ currency: "USD", amount: 3000 }] });
    const all = await getAdminUpsells(parseAdminUpsellFilter({}), { all: true });
    assert.equal(all.rows.find((r) => r.id === "ups_2")!.currencyMismatch, true);
    const csv = upsellsToCsv(all.rows);
    assert.equal(csv.trim().split("\r\n").length, 3);
    assert.ok(csv.includes("Add the advanced course"));
  });
});
