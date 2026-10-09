import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDb } from "@/lib/db/store";
import { createSession } from "@/lib/auth/session";
import { defaultSettings } from "@/lib/db/defaults";
import { placeOrderAction, savePaymentGatewaySettingsAction, submitPaymentReferenceAction } from "@/lib/actions/payments";
import {
  checkoutMethods,
  hasManualDetails,
  normalizeBuyerReference,
  preferredMethod,
  resolveCheckoutMethod,
  upiPayUrl,
  type GatewayStatus,
} from "@/lib/payments/methods";
import { makeCourse, makeUser, resetDb } from "./helpers/db";
import { captureRedirect, resetRequest } from "./helpers/request";

const none: GatewayStatus = () => ({ configured: false, mode: null });
const stripeOnly: GatewayStatus = (g) => (g === "stripe" ? { configured: true, mode: "test" } : { configured: false, mode: null });
const commerce = (patch: Partial<ReturnType<typeof defaultSettings>["commerce"]> = {}) => ({ ...defaultSettings().commerce, ...patch });

describe("checkout payment methods", () => {
  it("offers every enabled method with the main gateway first, online ones ready only with keys", () => {
    const methods = checkoutMethods(commerce({ paymentGateway: "manual" }), stripeOnly);
    assert.deepEqual(
      methods.map((m) => m.id),
      ["manual", "razorpay", "stripe"],
    );
    assert.deepEqual(
      methods.map((m) => m.ready),
      [true, false, true],
    );
    assert.equal(methods.find((m) => m.id === "stripe")!.mode, "test");
    assert.equal(preferredMethod(methods), "manual");
  });

  it("leaves out switched-off methods but always offers the main gateway", () => {
    const methods = checkoutMethods(commerce({ paymentGateway: "stripe", paymentMethods: { stripe: false, razorpay: false, manual: true } }), stripeOnly);
    assert.deepEqual(
      methods.map((m) => m.id),
      ["stripe", "manual"],
    );
    assert.deepEqual(checkoutMethods(commerce({ paymentGateway: "none" }), stripeOnly), []);
  });

  it("preselects the first method that can take a payment", () => {
    const methods = checkoutMethods(commerce({ paymentGateway: "razorpay", paymentMethods: { stripe: true, razorpay: true, manual: false } }), stripeOnly);
    assert.equal(preferredMethod(methods), "stripe");
  });

  it("checks the submitted method, falling back to the main gateway when none is sent", () => {
    const c = commerce({ paymentGateway: "manual" });
    assert.deepEqual(resolveCheckoutMethod("", c, none), { ok: true, method: "manual" });
    assert.deepEqual(resolveCheckoutMethod("manual", c, none), { ok: true, method: "manual" });
    assert.equal(resolveCheckoutMethod("stripe", c, none).ok, false, "no keys yet");
    assert.deepEqual(resolveCheckoutMethod("stripe", c, stripeOnly), { ok: true, method: "stripe" });
    assert.equal(resolveCheckoutMethod("paypal", c, stripeOnly).ok, false);
    const off = commerce({ paymentGateway: "manual", paymentMethods: { stripe: false, razorpay: true, manual: true } });
    assert.equal(resolveCheckoutMethod("stripe", off, stripeOnly).ok, false, "switched off in settings");
    // The main gateway without keys and no method sent: the message checkout always gave.
    const r = resolveCheckoutMethod("", commerce({ paymentGateway: "stripe" }), none);
    assert.ok(!r.ok && /not available right now/.test(r.error));
  });

  it("cleans and checks the buyer's transfer reference", () => {
    assert.deepEqual(normalizeBuyerReference("  UTR  4521 8890 "), { ok: true, value: "UTR 4521 8890" });
    assert.deepEqual(normalizeBuyerReference(""), { ok: true, value: "" });
    assert.equal(normalizeBuyerReference("<script>").ok, false);
    assert.equal(normalizeBuyerReference("x".repeat(81)).ok, false);
  });

  it("knows when bank details exist and builds a UPI link with the amount", () => {
    assert.equal(hasManualDetails({}), false);
    assert.equal(hasManualDetails({ instructions: "Pay us" }), false);
    assert.equal(hasManualDetails({ upiId: "school@okbank" }), true);
    const url = upiPayUrl({ upiId: "school@okbank", accountName: "LearnLoop" }, 49900, "ORD-1");
    assert.ok(url?.startsWith("upi://pay?"));
    const params = new URLSearchParams(url!.slice("upi://pay?".length));
    assert.equal(params.get("pa"), "school@okbank");
    assert.equal(params.get("am"), "499.00");
    assert.equal(params.get("cu"), "INR");
    assert.equal(upiPayUrl({}, 100, "x"), null);
  });
});

const buyer = makeUser({ id: "usr_buyer", name: "Bea Buyer", email: "bea@example.com" });
const other = makeUser({ id: "usr_other", name: "Olly Other" });
const admin = makeUser({ id: "usr_admin", name: "Ada Admin", roles: ["admin"] });
const course = makeCourse({ id: "crs_pay", slug: "pay", title: "Paid course", paidCourse: true, price: 10000, currency: "USD" });

async function setup(methods = { stripe: true, razorpay: true, manual: true }) {
  await resetDb({
    users: [buyer, other, admin],
    courses: [course],
    settings: {
      email: { enabled: false },
      gamification: { enabled: false },
      commerce: { paymentGateway: "manual", paymentMethods: methods, applyTax: false, taxPercentage: 0, defaultCurrency: "USD" },
    },
  });
  resetRequest();
}

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
};
const order = (extra: Record<string, string> = {}) =>
  form({ itemType: "course", itemId: course.id, expectedTotal: "10000", billingName: "Bea Buyer", line1: "1 Main Street", city: "Capital", country: "India", state: "Karnataka", source: "Search engine", consent: "on", ...extra });

describe("placing an order with a chosen method", () => {
  it("places a bank transfer order with the buyer's reference", async () => {
    await setup();
    await createSession(buyer.id);
    const target = await captureRedirect(() => placeOrderAction(null, order({ method: "manual", reference: " UTR 1234  5678 " })));
    assert.match(target, /^\/billing\/success\/ORD-/);
    const payment = (await getDb()).payments[0]!;
    assert.equal(payment.gateway, "manual");
    assert.equal(payment.status, "pending");
    assert.equal(payment.buyerReference, "UTR 1234 5678");
    assert.ok(payment.buyerReferenceAt);
  });

  it("refuses online methods without keys and methods switched off", async () => {
    await setup({ stripe: true, razorpay: false, manual: true });
    await createSession(buyer.id);
    const noKeys = await placeOrderAction(null, order({ method: "stripe" }));
    assert.ok(!noKeys.ok && noKeys.fieldErrors?.method);
    const off = await placeOrderAction(null, order({ method: "razorpay" }));
    assert.ok(!off.ok && off.fieldErrors?.method);
    assert.equal((await getDb()).payments.length, 0, "no order is created");
  });

  it("refuses a reference with characters that don't belong in one", async () => {
    await setup();
    await createSession(buyer.id);
    const res = await placeOrderAction(null, order({ method: "manual", reference: "<b>hi</b>" }));
    assert.ok(!res.ok && res.fieldErrors?.reference);
  });

  it("still uses the main gateway when the form sends no method", async () => {
    await setup();
    await createSession(buyer.id);
    await captureRedirect(() => placeOrderAction(null, order()));
    assert.equal((await getDb()).payments[0]!.gateway, "manual");
  });
});

describe("adding a transfer reference after ordering", () => {
  it("lets the buyer add and change it while the order is pending, and nobody else", async () => {
    await setup();
    await createSession(buyer.id);
    await captureRedirect(() => placeOrderAction(null, order({ method: "manual" })));
    const { orderId } = (await getDb()).payments[0]!;

    const empty = await submitPaymentReferenceAction(null, form({ orderId, reference: "  " }));
    assert.ok(!empty.ok && empty.fieldErrors?.reference);
    assert.ok((await submitPaymentReferenceAction(null, form({ orderId, reference: "IMPS-998877" }))).ok);
    assert.equal((await getDb()).payments[0]!.buyerReference, "IMPS-998877");
    const admins = (await getDb()).notifications.filter((n) => n.userId === admin.id);
    assert.ok(admins.some((n) => /IMPS-998877/.test(n.message ?? "")), "administrators are told");

    await createSession(other.id);
    const stranger = await submitPaymentReferenceAction(null, form({ orderId, reference: "HACK" }));
    assert.ok(!stranger.ok);
    assert.equal((await getDb()).payments[0]!.buyerReference, "IMPS-998877");
  });
});

describe("Settings → Payments", () => {
  const base = { defaultCurrency: "INR", paymentGateway: "manual", taxPercentage: "0", taxLabel: "Tax" };

  it("saves the checkout methods and the bank / UPI details", async () => {
    await setup();
    await createSession(admin.id);
    const res = await savePaymentGatewaySettingsAction(
      null,
      form({
        ...base,
        method_razorpay: "on",
        manualAccountName: "LearnLoop Academy",
        manualBankName: "State Bank",
        manualAccountNumber: "1234 5678 9012",
        manualIfsc: "sbin0001234",
        manualSwift: "",
        manualUpiId: "learnloop@okicici",
        manualInstructions: "NEFT, IMPS or UPI.",
      }),
    );
    assert.ok(res.ok, res.ok ? "" : res.error);
    const c = (await getDb()).settings.commerce;
    assert.deepEqual(c.paymentMethods, { stripe: false, razorpay: true, manual: true }, "the main gateway stays on");
    assert.equal(c.manualPayment.accountNumber, "123456789012");
    assert.equal(c.manualPayment.ifsc, "SBIN0001234");
    assert.equal(c.manualPayment.swift, undefined, "empty fields are dropped");
    assert.equal(c.manualPayment.upiId, "learnloop@okicici");
  });

  it("rejects details that can't be right", async () => {
    await setup();
    await createSession(admin.id);
    const res = await savePaymentGatewaySettingsAction(null, form({ ...base, manualAccountName: "", manualUpiId: "not a upi id", manualSwift: "ABC" }));
    assert.ok(!res.ok);
    assert.ok(res.fieldErrors?.manualUpiId && res.fieldErrors?.manualSwift);
  });
});
