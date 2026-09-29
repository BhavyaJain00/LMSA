import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db/store";
import { setFlash } from "@/lib/flash";
import { gatewayErrorMessage, reconcileStripeSession } from "@/lib/payments/gateway";
import { isStripeConfigured, isStripeSessionId, retrieveStripeCheckoutSession, type StripeCheckoutSession } from "@/lib/payments/stripe";

/**
 * GET /api/payments/stripe/return?session_id=cs_… — Stripe Checkout's
 * success URL. The session is read back from Stripe with the secret key and
 * the order is fulfilled only when Stripe reports `payment_status: "paid"`
 * (and the amount matches). Nothing in the query string is trusted beyond the
 * session id. The learner then lands on the order page.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  const sessionId = req.nextUrl.searchParams.get("session_id") ?? "";

  if (!isStripeSessionId(sessionId)) {
    await setFlash("We couldn't find that checkout. Your orders are listed below.", "error");
    return to("/billing/history");
  }

  const db = await getDb();
  const local = db.payments.find((p) => p.gateway === "stripe" && p.gatewayOrderId === sessionId);
  const orderPage = (orderId: string) => `/billing/success/${encodeURIComponent(orderId)}`;

  if (!isStripeConfigured()) {
    await setFlash("Card payments are temporarily unavailable. Your order is saved; we'll confirm it as soon as possible.", "warning");
    return to(local ? orderPage(local.orderId) : "/billing/history");
  }

  let session: StripeCheckoutSession;
  try {
    session = await retrieveStripeCheckoutSession(sessionId, { timeoutMs: 15_000 });
  } catch (error) {
    console.warn(`[payments] Stripe return for ${sessionId} could not be verified: ${gatewayErrorMessage(error)}`);
    await setFlash("We're confirming your payment with Stripe. This page updates as soon as it's done.", "info");
    return to(local ? orderPage(local.orderId) : "/billing/history");
  }

  const ourId = session.metadata.paymentId || session.clientReferenceId;
  const payment = local ?? db.payments.find((p) => p.gateway === "stripe" && !!ourId && p.id === ourId);
  if (!payment) {
    await setFlash("We couldn't match this payment to an order. Please contact support with your receipt from Stripe.", "error");
    return to("/billing/history");
  }

  const state = await reconcileStripeSession({ ...payment }, session, "stripe_return");
  revalidatePath(orderPage(payment.orderId));
  revalidatePath("/billing/history");
  switch (state.state) {
    case "paid":
      revalidatePath("/", "layout");
      await setFlash("Payment successful. You're all set!", "success");
      break;
    case "processing":
      await setFlash("Your payment is being processed. We'll enroll you as soon as your bank confirms it.", "info");
      break;
    case "failed":
      await setFlash(state.reason ?? "The payment was not completed.", "error");
      break;
    case "pending":
      await setFlash("The payment hasn't been completed yet.", "warning");
      break;
    default:
      await setFlash(state.message, "error");
  }
  return to(orderPage(payment.orderId));
}
