import { NextResponse, type NextRequest } from "next/server";
import type { DataRequest } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { authRateLimiter } from "@/lib/auth/rate-limit";
import { siteConfig } from "@/lib/config";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { personalDataSections, serializePersonalData } from "@/lib/legal/export";
import { isDeletedAccount } from "@/lib/legal/erase";
import { uid } from "@/lib/utils";

/**
 * POST /api/privacy/export — "Download my data" (GDPR access/portability).
 *
 * Submitted as a plain form from /settings/privacy (or by an administrator
 * from the audit log with `userId`, for requests received by email). Replies
 * with a JSON attachment streamed record by record; problems redirect back
 * to the page with `?export=<reason>` so the browser never lands on a bare
 * error. Every export is recorded as a completed `DataRequest` and audited.
 */

export const dynamic = "force-dynamic";

const OWN_LIMIT = { limit: 5, windowMs: 60 * 60 * 1000 };
const ADMIN_LIMIT = { limit: 30, windowMs: 60 * 60 * 1000 };
/** Chunks are coalesced to about this size before they are handed to the stream. */
const CHUNK_BYTES = 64 * 1024;

function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  const allowed = new Set([req.nextUrl.origin]);
  try {
    allowed.add(new URL(siteConfig.appUrl).origin);
  } catch {
    /* malformed APP_URL: only the request origin counts */
  }
  return allowed.has(origin);
}

function back(req: NextRequest, path: string, reason: string): NextResponse {
  const url = new URL(path, req.nextUrl.origin);
  url.searchParams.set("export", reason);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store" } });
}

function fileName(username: string, now: Date): string {
  const safe = username.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "member";
  return `personal-data-${safe}-${now.toISOString().slice(0, 10)}.json`;
}

/** Pull-based stream over the serializer: memory stays bounded by one chunk. */
function streamOf(chunks: Generator<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      let buffer = "";
      for (;;) {
        const next = chunks.next();
        if (next.done) {
          if (buffer) controller.enqueue(encoder.encode(buffer));
          controller.close();
          return;
        }
        buffer += next.value;
        if (buffer.length >= CHUNK_BYTES) {
          controller.enqueue(encoder.encode(buffer));
          return;
        }
      }
    },
    cancel() {
      chunks.return(undefined);
    },
  });
}

export async function POST(req: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return NextResponse.redirect(new URL("/login?next=/settings/privacy", req.nextUrl.origin), { status: 303 });
  if (!isSameOrigin(req)) return NextResponse.json({ ok: false, error: "Cross-site requests are not accepted." }, { status: 403 });

  let requestedId = "";
  try {
    const form = await req.formData();
    const value = form.get("userId");
    requestedId = typeof value === "string" ? value.trim().slice(0, 100) : "";
  } catch {
    requestedId = "";
  }
  const forOther = !!requestedId && requestedId !== viewer.id;
  const returnPath = forOther ? "/admin/audit?tab=requests" : "/settings/privacy";
  if (forOther && !isAdmin(viewer)) return back(req, "/settings/privacy", "denied");

  const limited = authRateLimiter.hit(`privacy-export:${viewer.id}`, forOther ? ADMIN_LIMIT : OWN_LIMIT);
  if (!limited.ok) return back(req, returnPath, "limited");

  const subjectId = forOther ? requestedId : viewer.id;
  const [db, settings] = await Promise.all([getDb(), getSettings()]);
  const subject = db.users.find((u) => u.id === subjectId);
  if (!subject || isDeletedAccount(subject)) return back(req, returnPath, "missing");

  // Collected in one synchronous pass, so the export is a consistent snapshot.
  const sections = personalDataSections(db, subjectId);
  if (!sections) return back(req, returnPath, "missing");
  const records = sections.reduce((n, s) => n + s.rows.length, 0);

  const now = new Date();
  const request: DataRequest = { id: uid("dreq"), userId: subjectId, type: "export", status: "completed", createdAt: now.toISOString(), completedAt: now.toISOString() };
  await mutate((d) => {
    d.dataRequests.push(request);
  });
  await audit(viewer, "privacy.export", { type: "user", id: subjectId }, { records, sections: sections.length, byAdmin: forOther });

  const body = streamOf(serializePersonalData(sections, { exportedAt: now.toISOString(), siteName: settings.brand.name, siteUrl: siteConfig.appUrl }));
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName(subject.username, now)}"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
    },
  });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "Use the “Download my data” button in your privacy settings." }, { status: 405, headers: { Allow: "POST" } });
}
