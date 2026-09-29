import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  STRIPE_TOLERANCE_SECONDS,
  hmacSha256Hex,
  safeEqualHex,
  signStripePayload,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  verifyStripeSignature,
} from "@/lib/payments/signatures";

const STRIPE_SECRET = "whsec_test_0123456789abcdef";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_test_1", amount_total: 1999 } } });
const T = 1_780_000_000;
const NOW_MS = T * 1000;

const stripeSig = (body: string, t = T, secret = STRIPE_SECRET) => createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");

describe("hmacSha256Hex / safeEqualHex", () => {
  it("computes HMAC-SHA256 (known vector)", () => {
    assert.equal(hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"), "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
    assert.equal(hmacSha256Hex("key", Buffer.from("abc")), hmacSha256Hex("key", "abc"));
  });

  it("compares hex digests in constant time and fails closed", () => {
    const a = hmacSha256Hex("k", "x");
    assert.equal(safeEqualHex(a, a), true);
    assert.equal(safeEqualHex(a, a.toUpperCase()), true);
    assert.equal(safeEqualHex(a, hmacSha256Hex("k", "y")), false);
    assert.equal(safeEqualHex(a, a.slice(0, -2)), false);
    assert.equal(safeEqualHex(a, `${a.slice(0, -1)}g`), false);
    assert.equal(safeEqualHex("abc", "abc"), false);
    assert.equal(safeEqualHex("", ""), false);
    assert.equal(safeEqualHex(a, undefined as unknown as string), false);
  });
});

describe("verifyStripeSignature", () => {
  it("accepts a valid signature and returns the timestamp", () => {
    assert.deepEqual(verifyStripeSignature(BODY, `t=${T},v1=${stripeSig(BODY)}`, STRIPE_SECRET, { now: NOW_MS }), { ok: true, timestamp: T });
    assert.equal(signStripePayload(BODY, STRIPE_SECRET, T), `t=${T},v1=${stripeSig(BODY)}`);
  });

  it("accepts the raw body as string, Buffer or Uint8Array view", () => {
    const header = signStripePayload(BODY, STRIPE_SECRET, T);
    const padded = Buffer.from(`xx${BODY}yy`);
    const view = new Uint8Array(padded.buffer, padded.byteOffset + 2, Buffer.byteLength(BODY));
    for (const raw of [BODY, Buffer.from(BODY), view]) assert.equal(verifyStripeSignature(raw, header, STRIPE_SECRET, { now: NOW_MS }).ok, true);
  });

  it("rejects tampered bodies, other secrets and other timestamps", () => {
    const header = signStripePayload(BODY, STRIPE_SECRET, T);
    const tampered = BODY.replace("1999", "1");
    assert.deepEqual(verifyStripeSignature(tampered, header, STRIPE_SECRET, { now: NOW_MS }), { ok: false, reason: "Signature mismatch." });
    assert.equal(verifyStripeSignature(BODY, header, "whsec_other", { now: NOW_MS }).ok, false);
    // Replaying the signature with a fresh timestamp does not work either.
    assert.equal(verifyStripeSignature(BODY, `t=${T + 10},v1=${stripeSig(BODY)}`, STRIPE_SECRET, { now: NOW_MS }).ok, false);
  });

  it("enforces the timestamp tolerance both ways", () => {
    const header = signStripePayload(BODY, STRIPE_SECRET, T);
    assert.equal(STRIPE_TOLERANCE_SECONDS, 300);
    assert.equal(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS + 300_000 }).ok, true);
    assert.deepEqual(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS + 301_000 }), { ok: false, reason: "Signature timestamp outside the tolerance window." });
    assert.equal(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS - 301_000 }).ok, false);
    assert.equal(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS + 30_000, toleranceSeconds: 10 }).ok, false);
  });

  it("accepts any matching v1 signature (secret rotation) and ignores other schemes", () => {
    const header = `t=${T},v0=${stripeSig(BODY, T, "old")},v1=${"0".repeat(64)},v1=${stripeSig(BODY)}`;
    assert.equal(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS }).ok, true);
    assert.deepEqual(verifyStripeSignature(BODY, `t=${T},v0=${stripeSig(BODY)}`, STRIPE_SECRET, { now: NOW_MS }), { ok: false, reason: "No v1 signature in header." });
  });

  it("fails closed on malformed headers and missing configuration", () => {
    const sig = stripeSig(BODY);
    const cases: [string | null | undefined, string][] = [
      [null, "Missing Stripe-Signature header."],
      ["", "Missing Stripe-Signature header."],
      [`t=${T},v1=${sig},${"x".repeat(5000)}`, "Missing Stripe-Signature header."],
      [`v1=${sig}`, "Signature timestamp missing."],
      [`t=abc,v1=${sig}`, "Malformed signature timestamp."],
      [`t=1234567890123,v1=${sig}`, "Malformed signature timestamp."],
      [`t=${T}`, "No v1 signature in header."],
      [`t=${T},${Array.from({ length: 17 }, () => `v1=${sig}`).join(",")}`, "Too many signatures in header."],
    ];
    for (const [header, reason] of cases) assert.deepEqual(verifyStripeSignature(BODY, header, STRIPE_SECRET, { now: NOW_MS }), { ok: false, reason }, String(header).slice(0, 40));
    assert.deepEqual(verifyStripeSignature(BODY, `t=${T},v1=${sig}`, "", { now: NOW_MS }), { ok: false, reason: "Webhook signing secret is not configured." });
  });
});

describe("Razorpay signatures", () => {
  const keySecret = "rzp_secret_test";
  const orderId = "order_Nq3kQ1";
  const paymentId = "pay_Nq3kX9";
  const checkoutSig = createHmac("sha256", keySecret).update(`${orderId}|${paymentId}`).digest("hex");

  it("verifies the checkout signature over order_id|payment_id", () => {
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: checkoutSig }, keySecret), true);
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: ` ${checkoutSig.toUpperCase()} ` }, keySecret), true);
  });

  it("rejects swapped ids, wrong secrets and malformed input", () => {
    assert.equal(verifyRazorpayPaymentSignature({ orderId: "order_other", paymentId, signature: checkoutSig }, keySecret), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId: paymentId, paymentId: orderId, signature: checkoutSig }, keySecret), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: checkoutSig }, "other"), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: checkoutSig }, ""), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: "" }, keySecret), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId: "o".repeat(65), paymentId, signature: checkoutSig }, keySecret), false);
    assert.equal(verifyRazorpayPaymentSignature({ orderId, paymentId, signature: "f".repeat(300) }, keySecret), false);
  });

  it("verifies webhook bodies", () => {
    const webhookSecret = "rzp_webhook_secret";
    const body = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, amount: 50000 } } } });
    const header = createHmac("sha256", webhookSecret).update(body).digest("hex");
    assert.equal(verifyRazorpayWebhookSignature(body, header, webhookSecret), true);
    assert.equal(verifyRazorpayWebhookSignature(Buffer.from(body), header, webhookSecret), true);
    assert.equal(verifyRazorpayWebhookSignature(body.replace("50000", "5"), header, webhookSecret), false);
    assert.equal(verifyRazorpayWebhookSignature(body, header, "other"), false);
    assert.equal(verifyRazorpayWebhookSignature(body, null, webhookSecret), false);
    assert.equal(verifyRazorpayWebhookSignature(body, header, ""), false);
    assert.equal(verifyRazorpayWebhookSignature(body, "a".repeat(257), webhookSecret), false);
  });
});
