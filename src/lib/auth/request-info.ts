import "server-only";
import { headers } from "next/headers";

/**
 * Client IP and user agent for the current request (used for rate limiting and
 * the login history).
 *
 * The IP comes from `x-forwarded-for` (first hop, as set by the reverse proxy)
 * or `x-real-ip`. Behind no proxy these headers are client-controlled, so the
 * IP is only one of several keys the limiter uses — account-level counters
 * and lockouts do not depend on it.
 */

const MAX_UA_LENGTH = 300;

/** Normalise one IP token: strip brackets/ports/zone ids and reject anything that isn't IP-like. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (!ip) return null;
  // "[2001:db8::1]:443" → "2001:db8::1"
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(ip);
  if (bracketed) ip = bracketed[1]!;
  // "203.0.113.7:51234" → "203.0.113.7"
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
  if (v4WithPort) ip = v4WithPort[1]!;
  ip = ip.replace(/%.*$/, "");
  if (ip.toLowerCase().startsWith("::ffff:") && /^::ffff:\d{1,3}(\.\d{1,3}){3}$/i.test(ip)) ip = ip.slice(7);
  if (ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip)) return null;
  return ip.toLowerCase();
}

/** First valid address from `x-forwarded-for`, else `x-real-ip`. */
export function parseClientIp(forwardedFor: string | null | undefined, realIp: string | null | undefined): string {
  if (forwardedFor) {
    for (const part of forwardedFor.split(",")) {
      const ip = normalizeIp(part);
      if (ip) return ip;
    }
  }
  return normalizeIp(realIp) ?? "unknown";
}

export interface RequestInfo {
  ip: string;
  userAgent: string;
}

export async function getRequestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const ua = (h.get("user-agent") ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return {
    ip: parseClientIp(h.get("x-forwarded-for"), h.get("x-real-ip")),
    userAgent: ua.length > MAX_UA_LENGTH ? ua.slice(0, MAX_UA_LENGTH) : ua,
  };
}
