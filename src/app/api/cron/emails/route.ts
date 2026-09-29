import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_RUN_LIMIT, deliverDueEmails, getOutboxCounts, pruneOutbox, verifyCronKey } from "@/lib/email";

/**
 * Scheduled email delivery.
 *
 *   GET or POST /api/cron/emails?key=<cron key>[&limit=50]
 *   (or send the key as `Authorization: Bearer <cron key>`)
 *
 * The key is derived from APP_SECRET and shown to admins in Settings → Email.
 * Each call delivers due messages (new ones and retries whose backoff has
 * elapsed) and deletes sent messages older than 90 days. Call it every
 * minute from cron, a systemd timer or your host's scheduler.
 */

export const dynamic = "force-dynamic";

const SENT_RETENTION_DAYS = 90;

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : null;
  const key = bearer ?? request.nextUrl.searchParams.get("key");
  if (!verifyCronKey(key)) return unauthorized();

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : DEFAULT_RUN_LIMIT;
  try {
    const result = await deliverDueEmails(limit, { wait: true, force: true });
    const pruned = await pruneOutbox(SENT_RETENTION_DAYS);
    const counts = await getOutboxCounts();
    return NextResponse.json(
      {
        ok: !result.error,
        ran: result.ran,
        reason: result.reason ?? null,
        transport: result.transport,
        claimed: result.claimed,
        sent: result.sent,
        retried: result.retried,
        failed: result.failed,
        durationMs: result.durationMs,
        error: result.error ?? null,
        pruned,
        outbox: { queued: counts.queued, sending: counts.sending, sent: counts.sent, failed: counts.failed },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[email] cron run failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Delivery run failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
