import type { NextRequest } from "next/server";
import { stripeEnv } from "@/lib/server-env";
import { parseJsonObject } from "@/lib/payments/http";
import { verifyStripeSignature } from "@/lib/payments/signatures";
import { parseStripeEvent } from "@/lib/payments/stripe";
import { handleStripeEvent } from "@/lib/payments/webhooks";

/**
 * POST /api/payments/stripe/webhook — Stripe event endpoint.
 *
 * The raw body is verified against the `Stripe-Signature` header
 * (HMAC-SHA256 of `${t}.${body}` with STRIPE_WEBHOOK_SECRET, constant-time,
 * 5-minute tolerance) before it is parsed. Bad or missing signatures get a
 * 400; handled and ignored events get a 200 so Stripe stops retrying; an
 * unexpected processing error returns 500 so Stripe retries the (idempotent)
 * delivery later.
 */

/** Stripe events are a few KB; refuse anything absurdly large before reading it. */
const MAX_BODY_BYTES = 512 * 1024;

function reply(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reply({ error: "Payload too large." }, 413);

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return reply({ error: "Payload too large." }, 413);

  const check = verifyStripeSignature(raw, req.headers.get("stripe-signature"), stripeEnv.webhookSecret);
  if (!check.ok) {
    console.warn(`[payments] rejected Stripe webhook: ${check.reason}`);
    return reply({ error: "Invalid signature." }, 400);
  }

  const body = parseJsonObject(raw.toString("utf8"));
  const event = body ? parseStripeEvent(body) : null;
  if (!event) return reply({ error: "Invalid event payload." }, 400);

  try {
    const outcome = await handleStripeEvent(event);
    console.info(`[payments] stripe ${event.type} ${event.id}: ${outcome.message}`);
    return reply({ received: true, handled: outcome.handled }, 200);
  } catch (error) {
    console.error(`[payments] stripe webhook ${event.id} (${event.type}) failed:`, error instanceof Error ? error.message : "unknown error");
    return reply({ error: "Event could not be processed." }, 500);
  }
}
