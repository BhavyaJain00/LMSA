import { NextResponse, type NextRequest } from "next/server";
import { verifyCronKey } from "@/lib/email";
import { DEFAULT_RUN_LIMIT, runWebhookDeliveries } from "@/lib/webhooks/delivery";

/**
 * Outgoing webhook deliveries.
 *
 *   GET or POST /api/cron/webhooks?key=<cron key>[&limit=200]
 *   (or send the key as `Authorization: Bearer <cron key>`)
 *
 * Uses the same cron key as `/api/cron/emails` (Settings → Email shows it).
 * Each call sends the deliveries that are due (new events and retries whose
 * backoff has elapsed), cancels deliveries of endpoints that were switched
 * off and prunes log entries older than 30 days. New events are also sent
 * right away by an in-process timer; calling this every minute keeps
 * retries on schedule across restarts and on hosts that freeze idle
 * processes.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : null;
  if (!verifyCronKey(bearer ?? request.nextUrl.searchParams.get("key"))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 1000) : DEFAULT_RUN_LIMIT;
  try {
    const run = await runWebhookDeliveries({ wait: true, limit, prune: true });
    return NextResponse.json(
      {
        ok: true,
        ran: run.ran,
        reason: run.reason ?? null,
        attempted: run.attempted,
        delivered: run.delivered,
        retrying: run.retrying,
        failed: run.failed,
        postponed: run.postponed,
        cancelled: run.cancelled,
        endpointsDisabled: run.disabled,
        pending: run.pending,
        pruned: run.pruned,
        nextRunAt: run.nextRunAt,
        durationMs: run.durationMs,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    console.error("[webhooks] cron run failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Webhook delivery run failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
