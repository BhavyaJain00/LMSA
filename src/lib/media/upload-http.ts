import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { getCurrentUser } from "@/lib/auth/session";
import { SlidingWindowRateLimiter, type RateLimitRule } from "@/lib/auth/rate-limit";
import { UPLOAD_LENGTH_HEADER, UPLOAD_OFFSET_HEADER, type UploadErrorCode } from "./resumable-shared";
import { UploadError } from "./resumable";

/**
 * Shared plumbing of the resumable upload routes (`/api/uploads/**`):
 * authentication, a same-origin check (the routes take cookies, so another
 * site must not be able to drive them), per-user rate limits and uniform
 * JSON errors carrying the current offset.
 */

const g = globalThis as unknown as { __llUploadLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llUploadLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

export const UPLOAD_RATE_LIMITS = {
  /** New uploads started per account. */
  create: { limit: 30, windowMs: 10 * 60_000 },
  /** Single-request uploads (`POST /api/upload`: images, documents, avatars) per account. */
  single: { limit: 60, windowMs: 10 * 60_000 },
  /** Chunks, offset checks and completions per account (8 MB chunks: plenty for gigabit links). */
  transfer: { limit: 1200, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } as const;

export function jsonError(status: number, error: string, offset?: number | null, extra: Record<string, string> = {}, code?: UploadErrorCode | null): NextResponse {
  const headers: Record<string, string> = { ...NO_STORE, ...extra };
  if (offset !== null && offset !== undefined) headers[UPLOAD_OFFSET_HEADER] = String(offset);
  return NextResponse.json({ ok: false, error, ...(code ? { code } : {}), ...(offset !== null && offset !== undefined ? { offset } : {}) }, { status, headers });
}

/** Map an exception to a response (unexpected errors are logged and answered with 500). */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UploadError) return jsonError(err.status, err.message, err.offset, {}, err.code);
  console.error("[uploads] request failed:", err instanceof Error ? err.message : err);
  return jsonError(500, "The upload could not be stored. Please try again.");
}

export function offsetHeaders(offset: number, length: number): Record<string, string> {
  return { ...NO_STORE, [UPLOAD_OFFSET_HEADER]: String(offset), [UPLOAD_LENGTH_HEADER]: String(length) };
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Requests from another site (by Origin or Sec-Fetch-Site) are refused. */
export function isCrossSite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const originHost = hostOf(origin);
  if (!originHost) return true;
  const allowed = new Set(
    [req.headers.get("host"), req.headers.get("x-forwarded-host")?.split(",")[0]?.trim(), hostOf(req.url), hostOf(siteConfig.appUrl)]
      .filter((h): h is string => !!h)
      .map((h) => h.toLowerCase()),
  );
  return !allowed.has(originHost);
}

/**
 * Authenticate an upload request: signed in, same site, within the rate
 * limit. Returns the user or the response to send.
 */
export async function authorizeUploadRequest(req: Request, rule: keyof typeof UPLOAD_RATE_LIMITS): Promise<{ user: User } | { response: NextResponse }> {
  if (isCrossSite(req)) return { response: jsonError(403, "Uploads must come from this site.") };
  const user = await getCurrentUser();
  if (!user) return { response: jsonError(401, "Sign in to upload files.", null, {}, "sign-in") };
  const limited = limiter.hit(`upload:${rule}:${user.id}`, UPLOAD_RATE_LIMITS[rule]);
  if (!limited.ok) {
    return { response: jsonError(429, "Too many upload requests. Please wait a moment.", null, { "Retry-After": String(Math.max(1, Math.ceil(limited.retryAfterMs / 1000))) }, "rate-limited") };
  }
  return { user };
}
