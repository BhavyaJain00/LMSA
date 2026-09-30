import { NextResponse, type NextRequest } from "next/server";
import { verifyCronKey } from "@/lib/email";
import { runComms } from "@/lib/comms/runner";

/**
 * Scheduled broadcasts and email sequences.
 *
 *   GET or POST /api/cron/comms?key=<cron key>
 *   (or send the key as `Authorization: Bearer <cron key>`)
 *
 * The key is the same one as for `/api/cron/emails` (derived from APP_SECRET,
 * shown to admins in Settings → Email and on the sequences page). Each call
 * starts scheduled broadcasts that are due, queues the next batches of
 * broadcasts that are sending (within their per-minute throttle), enrolls
 * newly confirmed leads and inactive members in their sequences, sends the
 * sequence emails that are due, refreshes campaign statistics and removes
 * tracking events nothing refers to any more. The same work runs from an
 * in-process timer and when staff open the broadcast pages; calling this
 * every minute (every five is fine) keeps it on time across restarts.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : null;
  const key = bearer ?? request.nextUrl.searchParams.get("key");
  if (!verifyCronKey(key)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  try {
    const run = await runComms({ wait: true });
    const { broadcasts, sequences } = run;
    return NextResponse.json(
      {
        ok: !run.error,
        durationMs: run.durationMs,
        emailDisabled: !!(broadcasts.emailDisabled || sequences.emailDisabled),
        broadcasts: { started: broadcasts.started, queued: broadcasts.queued, skipped: broadcasts.skipped, finished: broadcasts.finished, sending: broadcasts.sending },
        sequences: { enrolled: sequences.enrolled, sent: sequences.sent, completed: sequences.completed, stopped: sequences.stopped },
        statsUpdated: run.statsUpdated,
        eventsPruned: run.eventsPruned,
        nextRunAt: run.nextRunAt,
        error: run.error ? "Part of the run failed; see the server log." : null,
      },
      { status: run.error ? 500 : 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error("[comms] cron run failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Comms run failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
