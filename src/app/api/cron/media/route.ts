import { NextResponse, type NextRequest } from "next/server";
import { verifyCronKey } from "@/lib/email";
import { runMediaMaintenance } from "@/lib/media/maintenance";

/**
 * Media housekeeping.
 *
 *   GET or POST /api/cron/media?key=<cron key>
 *   (or send the key as `Authorization: Bearer <cron key>`)
 *
 * Uses the same cron key as `/api/cron/emails` (Settings → Email shows it).
 * Each call: expires resumable uploads idle for a day, queues uploaded lesson
 * videos that still need an HLS conversion and starts the converter, prunes
 * old conversion jobs, deletes HLS output no lesson uses any more and, with
 * S3 storage, moves files left on local disk to the bucket. Conversions run
 * in the background after the response. Call it every 5–15 minutes.
 */

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
}

async function handle(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const bearer = auth && /^Bearer\s+/i.test(auth) ? auth.replace(/^Bearer\s+/i, "") : null;
  if (!verifyCronKey(bearer ?? request.nextUrl.searchParams.get("key"))) return unauthorized();
  try {
    const result = await runMediaMaintenance();
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[media] cron run failed:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ ok: false, error: "Media maintenance failed" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
