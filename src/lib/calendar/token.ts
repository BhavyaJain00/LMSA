import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { User } from "@/lib/types";
import { getAppSecret } from "@/lib/server-env";
import { getDb } from "@/lib/db/store";

/**
 * Personal calendar feed tokens.
 *
 * `User.calendarToken` holds a random per-user secret. The token that appears
 * in the feed URL is NOT that value: it is `<userId>.<signature>`, where the
 * signature is an HMAC-SHA256 of the user id and the stored secret keyed with
 * APP_SECRET. So:
 *  - the database alone is not enough to read anyone's feed (the stored value
 *    is useless without APP_SECRET), which keeps the secret effectively hashed
 *    at rest while the settings page can still show the URL at any time;
 *  - regenerating `calendarToken` (or rotating APP_SECRET) revokes old URLs;
 *  - verification is a constant-time comparison of equal-length MACs.
 */

const VERSION = "v1";
const SIGNATURE_RE = /^[A-Za-z0-9_-]{43}$/;
const USER_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

/** A new random per-user secret (192 bits). */
export function newCalendarSecret(): string {
  return randomBytes(24).toString("base64url");
}

function sign(userId: string, secret: string): string {
  return createHmac("sha256", getAppSecret()).update(`calendar-feed:${VERSION}:${userId}:${secret}`).digest("base64url");
}

/** The URL token for a user, or null when the feed is turned off. */
export function feedTokenFor(user: Pick<User, "id" | "calendarToken">): string | null {
  if (!user.calendarToken) return null;
  return `${user.id}.${sign(user.id, user.calendarToken)}`;
}

/** Path of a user's feed, e.g. "/api/calendar/usr_x.AbC….ics". */
export function feedPathFor(user: Pick<User, "id" | "calendarToken">): string | null {
  const token = feedTokenFor(user);
  return token ? `/api/calendar/${token}.ics` : null;
}

/** Split the route parameter ("<userId>.<sig>" with an optional ".ics" suffix). */
export function parseFeedToken(raw: string): { userId: string; signature: string } | null {
  let value: string;
  try {
    value = decodeURIComponent(raw).trim();
  } catch {
    return null;
  }
  if (value.toLowerCase().endsWith(".ics")) value = value.slice(0, -4);
  if (value.length > 160) return null;
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const userId = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  if (!USER_ID_RE.test(userId) || !SIGNATURE_RE.test(signature)) return null;
  return { userId, signature };
}

/**
 * Resolve the enabled user a feed token belongs to, or null. Fails closed:
 * malformed tokens, unknown users, disabled accounts, turned-off feeds and
 * signature mismatches all return null.
 */
export async function findUserByFeedToken(raw: string): Promise<User | null> {
  const parsed = parseFeedToken(raw);
  if (!parsed) return null;
  const db = await getDb();
  const user = db.users.find((u) => u.id === parsed.userId);
  if (!user || !user.enabled || !user.calendarToken) return null;
  let expected: string;
  try {
    expected = sign(user.id, user.calendarToken);
  } catch {
    return null;
  }
  const a = Buffer.from(parsed.signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? user : null;
}
