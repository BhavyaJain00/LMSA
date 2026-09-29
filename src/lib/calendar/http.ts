import "server-only";
import { createHash } from "node:crypto";
import type { Settings } from "@/lib/types";
import type { CalendarEvent } from "./events";

/** Shared response helpers for the calendar route handlers. */

export const ICS_CONTENT_TYPE = "text/calendar; charset=utf-8";

const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

export function textResponse(status: number, message: string, extra: Record<string, string> = {}): Response {
  return new Response(`${message}\n`, {
    status,
    headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

/**
 * Weak validator for a feed: it changes whenever any event or the calendar
 * metadata changes (the body itself also differs by its DTSTAMP, hence weak).
 */
export function feedEtag(events: CalendarEvent[], meta: unknown): string {
  const hash = createHash("sha256").update(JSON.stringify([meta, events])).digest("base64url").slice(0, 32);
  return `W/"${hash}"`;
}

/** Whether the request's If-None-Match matches the current ETag (weak comparison). */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const bare = etag.replace(/^W\//, "");
  return header
    .split(",")
    .map((t) => t.trim().replace(/^W\//, ""))
    .includes(bare);
}

export function icsResponse(
  body: string,
  opts: { filename: string; disposition: "inline" | "attachment"; etag?: string; cacheControl?: string },
): Response {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    "Content-Type": ICS_CONTENT_TYPE,
    "Content-Disposition": `${opts.disposition}; filename="${opts.filename.replace(/["\\\r\n]/g, "")}"`,
    "Cache-Control": opts.cacheControl ?? "private, no-cache",
  };
  if (opts.etag) headers.ETag = opts.etag;
  return new Response(body, { status: 200, headers });
}

export function notModified(etag: string, cacheControl = "private, no-cache"): Response {
  return new Response(null, { status: 304, headers: { ...BASE_HEADERS, ETag: etag, "Cache-Control": cacheControl } });
}

/** "LearnLoop" → calendar display name and description for a member's feed. */
export function feedCalendarMeta(settings: Settings): { name: string; description: string; color: string } {
  const brand = settings.brand.name.trim() || "LearnLoop";
  return {
    name: brand,
    description: `Your live classes, batch schedule and evaluations on ${brand}.`,
    color: settings.brand.accentColor,
  };
}
