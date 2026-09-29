import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Database, Payment } from "@/lib/types";
import { amountMatches, currencyExponent, fromGatewayAmount, parseDecimalAmount, toGatewayAmount } from "@/lib/payments/amounts";
import {
  assignInvoiceNumber,
  backfillInvoiceNumbers,
  buildInvoiceView,
  deriveTaxRate,
  formatAddressLines,
  formatInvoiceNumber,
  hasInvoice,
  isInvoiceable,
  needsInvoiceNumber,
  parseInvoiceNumber,
} from "@/lib/payments/invoice";
import { getDb } from "@/lib/db/store";
import { buildSettings, makePayment, makeUser, resetDb } from "../helpers/db";

describe("gateway amounts", () => {
  it("knows each currency's smallest unit", () => {
    assert.equal(currencyExponent("USD"), 2);
    assert.equal(currencyExponent("jpy"), 0);
    assert.equal(currencyExponent("KWD"), 3);
    assert.equal(currencyExponent("XYZ"), 2);
  });

  it("converts app amounts (price × 100) to and from gateway units", () => {
    assert.equal(toGatewayAmount(1999, "USD"), 1999);
    assert.equal(toGatewayAmount(150000, "JPY"), 1500);
    assert.equal(toGatewayAmount(150050, "JPY"), 1501);
    assert.equal(toGatewayAmount(1250, "KWD"), 12500);
    assert.equal(fromGatewayAmount(1500, "JPY"), 150000);
    assert.equal(fromGatewayAmount(12500, "KWD"), 1250);
    for (const [amount, currency] of [
      [1999, "USD"],
      [150000, "JPY"],
      [1250, "BHD"],
      [49900, "INR"],
    ] as const) {
      assert.equal(fromGatewayAmount(toGatewayAmount(amount, currency), currency), amount);
    }
  });

  it("checks gateway-reported amounts strictly", () => {
    assert.equal(amountMatches(1999, "USD", 1999, "usd"), true);
    assert.equal(amountMatches(150000, "JPY", 1500, "JPY"), true);
    assert.equal(amountMatches(1999, "USD", 1998, "USD"), false);
    assert.equal(amountMatches(1999, "USD", 1999, "EUR"), false);
    assert.equal(amountMatches(1999, "USD", "1999", "USD"), false);
    assert.equal(amountMatches(1999, "USD", Number.NaN, "USD"), false);
    assert.equal(amountMatches(1999, "USD", 1999, undefined), false);
  });

  it("parses decimal amounts typed by admins", () => {
    assert.equal(parseDecimalAmount("12.50"), 1250);
    assert.equal(parseDecimalAmount("12.5"), 1250);
    assert.equal(parseDecimalAmount("0.29"), 29);
    assert.equal(parseDecimalAmount(" 7 "), 700);
    for (const bad of ["", "abc", "-1", "1.005", "1e3", "12,50", ".5", "1."]) assert.equal(parseDecimalAmount(bad), null, bad);
  });
});

describe("invoice numbers", () => {
  it("formats and parses INV-YYYY-NNNNN", () => {
    assert.equal(formatInvoiceNumber(2026, 42), "INV-2026-00042");
    assert.equal(formatInvoiceNumber(2026, 123456), "INV-2026-123456");
    assert.deepEqual(parseInvoiceNumber("INV-2026-00042"), { year: 2026, sequence: 42 });
    for (const bad of ["INV-2026-42", "inv-2026-00042", "INV-26-00042", "", null, undefined]) assert.equal(parseInvoiceNumber(bad), null, String(bad));
  });

  it("numbers paid orders sequentially per year and never renumbers", () => {
    const db = {
      payments: [
        makePayment({ userId: "u", itemId: "c", invoiceNumber: "INV-2026-00007", status: "paid", paidAt: "2026-02-01T00:00:00Z" }),
        makePayment({ userId: "u", itemId: "c", invoiceNumber: "INV-2025-00100", status: "paid", paidAt: "2025-12-31T00:00:00Z" }),
      ],
    } as unknown as Database;
    const a = makePayment({ userId: "u", itemId: "c", status: "paid", paidAt: "2026-03-01T00:00:00Z" });
    const b = makePayment({ userId: "u", itemId: "c", status: "paid", paidAt: "2025-06-01T00:00:00Z" });
    db.payments.push(a, b);
    assert.equal(assignInvoiceNumber(db, a), "INV-2026-00008");
    assert.equal(assignInvoiceNumber(db, a), "INV-2026-00008");
    assert.equal(assignInvoiceNumber(db, b), "INV-2025-00101");
    const noDate = makePayment({ userId: "u", itemId: "c", status: "paid", paidAt: "garbage" });
    db.payments.push(noDate);
    assert.equal(assignInvoiceNumber(db, noDate, new Date("2027-05-05T00:00:00Z")), "INV-2027-00001");
  });

  it("only invoices real sales", () => {
    const paid = makePayment({ userId: "u", itemId: "c", status: "paid", paidAt: "2026-01-01T00:00:00Z" });
    assert.equal(isInvoiceable(paid), true);
    assert.equal(isInvoiceable({ ...paid, amount: 0 }), false);
    assert.equal(isInvoiceable({ ...paid, gateway: "free" }), false);
    assert.equal(isInvoiceable({ ...paid, gateway: "none" }), false);
    assert.equal(needsInvoiceNumber(paid), true);
    assert.equal(needsInvoiceNumber({ ...paid, invoiceNumber: "INV-2026-00001" }), false);
    assert.equal(needsInvoiceNumber({ ...paid, status: "pending" }), false);
    assert.equal(hasInvoice({ ...paid, status: "refunded" }), true);
    assert.equal(hasInvoice({ ...paid, paidAt: undefined }), false);
  });

  it("backfills missing numbers oldest payment first (store)", async () => {
    const newer = makePayment({ id: "pay_newer", userId: "u", itemId: "c", status: "paid", paidAt: "2026-04-02T00:00:00Z" });
    const older = makePayment({ id: "pay_older", userId: "u", itemId: "c", status: "refunded", paidAt: "2026-04-01T00:00:00Z" });
    const pending = makePayment({ id: "pay_pending", userId: "u", itemId: "c", status: "pending" });
    await resetDb({ payments: [newer, older, pending] });
    assert.equal(await backfillInvoiceNumbers(), 2);
    const byId = new Map((await getDb()).payments.map((p) => [p.id, p.invoiceNumber]));
    assert.equal(byId.get("pay_older"), "INV-2026-00001");
    assert.equal(byId.get("pay_newer"), "INV-2026-00002");
    assert.equal(byId.get("pay_pending"), undefined);
    assert.equal(await backfillInvoiceNumbers(), 0);
  });
});

describe("invoice view", () => {
  beforeEach(async () => {
    await resetDb({ users: [makeUser({ id: "usr_buyer" })] });
  });

  it("derives the tax rate from stored amounts", () => {
    assert.equal(deriveTaxRate(10000, 1800, 18), 18);
    assert.equal(deriveTaxRate(10000, 1799, 18), 17.99);
    assert.equal(deriveTaxRate(3333, 600, 18), 18);
    assert.equal(deriveTaxRate(10000, 1800, 0), 18);
    assert.equal(deriveTaxRate(0, 100, 18), null);
    assert.equal(deriveTaxRate(10000, 0, 18), null);
  });

  it("formats billing addresses", () => {
    assert.deepEqual(formatAddressLines({ line1: "1 Main St", line2: " ", city: "Pune", state: "MH", pincode: "411001", country: "India" }), ["1 Main St", "Pune, MH, 411001", "India"]);
    assert.deepEqual(formatAddressLines(undefined), []);
  });

  it("builds the printable view with refund states", () => {
    const settings = buildSettings({ brand: { name: "LearnLoop", tagline: "" }, commerce: { taxLabel: "GST", taxPercentage: 18 } });
    const payment: Payment = makePayment({
      userId: "usr_buyer",
      itemId: "crs_1",
      itemTitle: "Intro to Python",
      originalAmount: 10000,
      discountAmount: 1000,
      taxAmount: 1620,
      amount: 10620,
      couponCode: "SAVE10",
      status: "paid",
      paidAt: "2026-03-01T10:00:00Z",
      invoiceNumber: "INV-2026-00003",
      address: { line1: "1 Main St", city: "Pune", country: "India" },
    });
    const view = buildInvoiceView(payment, { settings, buyer: { email: "b@example.com" }, gatewayLabel: "Stripe" })!;
    assert.equal(view.statusLabel, "Paid");
    assert.equal(view.taxableAmount, 9000);
    assert.equal(view.taxRate, 18);
    assert.equal(view.taxLabel, "GST");
    assert.equal(view.total, 10620);
    assert.equal(view.netAmount, 10620);
    assert.equal(view.item.typeLabel, "Course");
    assert.equal(view.seller.tagline, undefined);
    assert.deepEqual(view.buyer.addressLines, ["1 Main St", "Pune", "India"]);

    const partlyPaid = buildInvoiceView({ ...payment, refundedAmount: 620 }, { settings, buyer: null, gatewayLabel: "Stripe" })!;
    assert.equal(partlyPaid.statusLabel, "Paid · partially refunded");
    assert.equal(partlyPaid.netAmount, 10000);
    assert.equal(buildInvoiceView({ ...payment, status: "refunded" }, { settings, buyer: null, gatewayLabel: "Stripe" })!.statusLabel, "Refunded");
    const partial = buildInvoiceView({ ...payment, status: "refunded", refundedAmount: 5000 }, { settings, buyer: null, gatewayLabel: "Stripe" })!;
    assert.equal(partial.statusLabel, "Partially refunded");
    assert.equal(partial.netAmount, 5620);
    assert.equal(buildInvoiceView({ ...payment, invoiceNumber: undefined }, { settings, buyer: null, gatewayLabel: "Stripe" }), null);
    assert.equal(buildInvoiceView({ ...payment, status: "pending" }, { settings, buyer: null, gatewayLabel: "Stripe" }), null);
  });
});
