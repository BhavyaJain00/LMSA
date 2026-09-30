import { after, type NextRequest } from "next/server";
import { recordEmailHit, verifyPixelParam } from "@/lib/comms/tracking";

/**
 * Open-tracking pixel: GET /api/email/o/<emailId>.<signature>.gif
 *
 * Always answers with the same transparent 1×1 GIF (a bad signature reveals
 * nothing). A valid signature records an "open" for that outbox message
 * after the response is sent. Requests made from the app itself (a staff
 * member previewing the message) and HEAD probes are not counted.
 */

export const dynamic = "force-dynamic";

const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const HEADERS = {
  "Content-Type": "image/gif",
  "Content-Length": String(GIF.length),
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, private",
  Pragma: "no-cache",
  Expires: "0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

function pixel(): Response {
  return new Response(new Uint8Array(GIF), { status: 200, headers: HEADERS });
}

export async function GET(request: NextRequest, ctx: RouteContext<"/api/email/o/[id]">) {
  const { id } = await ctx.params;
  const emailId = verifyPixelParam(id);
  if (emailId && request.headers.get("sec-fetch-site") !== "same-origin") {
    after(async () => {
      try {
        await recordEmailHit(emailId, { type: "open" });
      } catch (error) {
        console.error("[email tracking] could not record an open:", error instanceof Error ? error.message : String(error));
      }
    });
  }
  return pixel();
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: HEADERS });
}
