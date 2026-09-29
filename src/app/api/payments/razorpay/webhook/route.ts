import type { NextRequest } from "next/server";
import { razorpayEnv } from "@/lib/server-env";
import { parseJsonObject } from "@/lib/payments/http";
import { verifyRazorpayWebhookSignature } from "@/lib/payments/signatures";
import { parseRazorpayEvent } from "@/lib/payments/razorpay";
import { handleRazorpayEvent } from "@/lib/payments/webhooks";

/**
 * POST /api/payments/razorpay/webhook — Razorpay event endpoint.
 *
 * The raw body is verified against `X-Razorpay-Signature` (HMAC-SHA256 of
 * the body with RAZORPAY_WEBHOOK_SECRET, constant-time) before it is parsed.
 * Bad signatures get a 400, handled/ignored events a 200, unexpected
 * processing errors a 500 so Razorpay retries the idempotent delivery.
 */

const MAX_BODY_BYTES = 512 * 1024;

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: "Payload too large." }, 413);

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "Payload too large." }, 413);

  if (!verifyRazorpayWebhookSignature(raw, req.headers.get("x-razorpay-signature"), razorpayEnv.webhookSecret)) {
    console.warn(`[payments] rejected Razorpay webhook: ${razorpayEnv.webhookSecret ? "signature mismatch" : "RAZORPAY_WEBHOOK_SECRET is not set"}`);
    return reply({ error: "Invalid signature." }, 400);
  }

  const body = parseJsonObject(raw.toString("utf8"));
  const event = body ? parseRazorpayEvent(body) : null;
  if (!event) return reply({ error: "Invalid event payload." }, 400);

  const eventId = (req.headers.get("x-razorpay-event-id") ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || "no-id";
  try {
    const outcome = await handleRazorpayEvent(event);
    console.info(`[payments] razorpay ${event.event} ${eventId}: ${outcome.message}`);
    // Retryable answer: the gateway delivers the (idempotent) event again later.
    if (outcome.retry) return reply({ received: true, retry: true }, 503, { "Retry-After": "120" });
    return reply({ received: true, handled: outcome.handled }, 200);
  } catch (error) {
    console.error(`[payments] razorpay webhook ${eventId} (${event.event}) failed:`, error instanceof Error ? error.message : "unknown error");
    return reply({ error: "Event could not be processed." }, 500);
  }
}
