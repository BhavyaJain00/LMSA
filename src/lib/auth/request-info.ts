import "server-only";
import { headers } from "next/headers";

/**
 * Client IP and user agent for the current request (used for rate limiting,
 * the login history and security emails).
 *
 * `X-Forwarded-For` / `X-Real-IP` are only as trustworthy as the proxies in
 * front of the app: the left part of `X-Forwarded-For` is whatever the client
 * sent, and without a proxy Next.js keeps a forged header as-is. So the IP is
 * taken from the proxy chain declared in `TRUST_PROXY_HOPS`:
 *
 *  - `0` (default): no proxy is trusted. Both headers are ignored and the IP
 *    is unknown (`UNKNOWN_IP`), so per-IP limits fall back to one shared,
 *    site-wide bucket (see `perIpLimit` in rate-limit.ts) and nothing an
 *    attacker sends ends up in the login history.
 *  - `N` > 0: N reverse proxies append to `X-Forwarded-For`; the client is the
 *    Nth entry counted from the right (the one your outermost proxy
 *    appended). If the header has fewer entries, or that entry isn't an IP,
 *    the IP is unknown. `X-Real-IP` is used only when `X-Forwarded-For` is
 *    absent altogether.
 */

const MAX_UA_LENGTH = 300;
const MAX_TRUSTED_HOPS = 20;

/** Stored/logged when the client IP can't be trusted or parsed. */
export const UNKNOWN_IP = "unknown";

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
  if (ip.length > 45 || !/^[0-9a-fA-F:.]+$/.test(ip) || !/[0-9a-fA-F]/.test(ip)) return null;
  return ip.toLowerCase();
}

/** `TRUST_PROXY_HOPS` as a whole number (0 when unset or invalid). Read on every call so tests can change it. */
export function trustedProxyHops(raw: string | undefined = process.env.TRUST_PROXY_HOPS): number {
  const value = (raw ?? "").trim();
  if (!/^\d{1,3}$/.test(value)) return 0;
  return Math.min(Number(value), MAX_TRUSTED_HOPS);
}

/**
 * The client IP from the proxy headers, trusting exactly `hops` proxies, or
 * null when it can't be known (no trusted proxy, too few hops, garbage).
 */
export function resolveClientIp(forwardedFor: string | null | undefined, realIp: string | null | undefined, hops: number): string | null {
  if (!Number.isInteger(hops) || hops <= 0) return null;
  const header = forwardedFor?.trim();
  if (header) {
    // Count raw entries (even malformed ones) so injected garbage can't shift the position.
    const entries = header.split(",");
    if (entries.length < hops) return null;
    return normalizeIp(entries[entries.length - hops]);
  }
  return normalizeIp(realIp);
}

/** Client IP for rate-limit keys and logs: the trusted address, or `UNKNOWN_IP`. */
export function parseClientIp(forwardedFor: string | null | undefined, realIp: string | null | undefined, hops: number = trustedProxyHops()): string {
  return resolveClientIp(forwardedFor, realIp, hops) ?? UNKNOWN_IP;
}

/** Same as `parseClientIp`, reading the headers of a Route Handler request. */
export function clientIpFromHeaders(h: Pick<Headers, "get">): string {
  return parseClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

export interface RequestInfo {
  /** Trusted client IP, or `UNKNOWN_IP`. */
  ip: string;
  userAgent: string;
}

export async function getRequestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const ua = (h.get("user-agent") ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return {
    ip: clientIpFromHeaders(h),
    userAgent: ua.length > MAX_UA_LENGTH ? ua.slice(0, MAX_UA_LENGTH) : ua,
  };
}
