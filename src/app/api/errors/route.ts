import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { perIpLimit, SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { clientIpFromHeaders } from "@/lib/auth/request-info";
import { siteConfig } from "@/lib/config";
import { hasRecentServerDigest, recordError } from "@/lib/errors/record";
import { parseBrowserReport } from "@/lib/errors/shared";

/**
 * POST /api/errors — error boundaries (`error.tsx`, `global-error.tsx`)
 * report what the visitor saw. Same-origin only, JSON up to 16 KB,
 * rate-limited per visitor. A report for a server error that
 * `onRequestError` already logged (same digest) is not counted twice.
 */

const MAX_BODY_BYTES = 16 * 1024;
const RULE = { limit: 10, windowMs: 10 * 60 * 1000 };
/** Visitors whose IP is unknown (no trusted proxy) share one bucket. */
const SHARED_RULE = { limit: 200, windowMs: 10 * 60 * 1000 };

const g = globalThis as unknown as { __llErrorReportLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llErrorReportLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

function reply(status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...HEADERS, ...extra } });
}

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

/** Read at most `limit` bytes of the body; null when it is larger. */
async function readLimited(req: NextRequest, limit: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return reply(403, { ok: false, error: "Cross-site reports are not accepted." });
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return reply(415, { ok: false, error: "Send the report as JSON." });
  }

  const user = await getCurrentUser();
  const bucket = user ? { key: `errors:u:${user.id}`, rule: RULE } : perIpLimit("errors:ip", clientIpFromHeaders(req.headers), RULE, SHARED_RULE);
  const limited = limiter.hit(bucket.key, bucket.rule);
  if (!limited.ok) {
    return reply(429, { ok: false, error: "Too many reports." }, { "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) });
  }

  const raw = await readLimited(req, MAX_BODY_BYTES);
  if (raw === null) return reply(413, { ok: false, error: "The report is too large." });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400, { ok: false, error: "The report is not valid JSON." });
  }
  const report = parseBrowserReport(body);
  if (!report) return reply(400, { ok: false, error: "The report has no message." });

  if (report.digest && (await hasRecentServerDigest(report.digest))) {
    return reply(202, { ok: true, recorded: false });
  }
  const event = await recordError({ ...report, userId: user?.id });
  return reply(202, { ok: true, recorded: !!event });
}
