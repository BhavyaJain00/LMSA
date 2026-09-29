import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAppSecret } from "@/lib/server-env";
import { GUEST_MEDIA_SUBJECT, splitMediaToken } from "./paths";

/**
 * Signed media tokens: `<expiresUnix>.<sig>` where
 * sig = base64url(HMAC-SHA256(APP_SECRET, `${path}|${subject}|${expires}`)).
 *
 * `path` is the canonical decoded pathname (see `canonicalMediaPath`) and
 * `subject` the viewer's user id, or "guest" for signed-out visitors. The
 * subject is never part of the URL: the file route takes it from the
 * session, so a copied link does not play for another account.
 */

/** Hard ceiling for any token lifetime, whatever the settings say. */
export const MAX_MEDIA_TOKEN_SECONDS = 240 * 60;
/** Clock skew tolerated between signing and verifying. */
const CLOCK_SKEW_SECONDS = 60;

export type MediaTokenFailure = "missing" | "malformed" | "expired" | "invalid";

export type MediaTokenResult = { ok: true; expires: number } | { ok: false; reason: MediaTokenFailure };

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The signing subject for a viewer: their user id, or "guest". */
export function mediaSubject(user: { id: string } | null | undefined): string {
  return user?.id || GUEST_MEDIA_SUBJECT;
}

function hmacDigest(secret: string, path: string, subject: string, expires: number): Buffer {
  return createHmac("sha256", secret).update(`${path}|${subject}|${expires}`).digest();
}

/** base64url(HMAC-SHA256) for a path/subject/expiry triple. */
export function computeMediaSignature(path: string, subject: string, expires: number, secret: string = getAppSecret()): string {
  return hmacDigest(secret, path, subject, expires).toString("base64url");
}

/** Create a token that expires at `expires` (unix seconds). */
export function createMediaToken(path: string, subject: string, expires: number, secret: string = getAppSecret()): string {
  if (!Number.isSafeInteger(expires) || expires <= 0) throw new Error("Invalid media token expiry.");
  return `${expires}.${computeMediaSignature(path, subject, expires, secret)}`;
}

/** Token valid for `ttlSeconds` from now (clamped to 1 s … MAX_MEDIA_TOKEN_SECONDS). */
export function issueMediaToken(path: string, subject: string, ttlSeconds: number, now = nowSeconds()): { token: string; expires: number } {
  const ttl = Math.min(Math.max(Math.floor(ttlSeconds), 1), MAX_MEDIA_TOKEN_SECONDS);
  const expires = now + ttl;
  return { token: createMediaToken(path, subject, expires), expires };
}

/**
 * Verify a token for a path and subject. Fails closed: anything malformed,
 * expired, too far in the future or with a wrong signature is rejected. The
 * signature comparison is constant-time.
 */
export function verifyMediaToken(
  path: string,
  subject: string,
  token: string | null | undefined,
  now = nowSeconds(),
  secret: string = getAppSecret(),
): MediaTokenResult {
  if (!token) return { ok: false, reason: "missing" };
  const parts = splitMediaToken(token);
  if (!parts) return { ok: false, reason: "malformed" };
  const { expires, signature } = parts;
  const given = Buffer.from(signature, "base64url");
  const expected = hmacDigest(secret, path, subject, expires);
  const sameLength = given.length === expected.length;
  // Always run the comparison so timing does not depend on the length check.
  const match = timingSafeEqual(sameLength ? given : expected, expected) && sameLength;
  if (!match) return { ok: false, reason: "invalid" };
  if (expires < now) return { ok: false, reason: "expired" };
  if (expires > now + MAX_MEDIA_TOKEN_SECONDS + CLOCK_SKEW_SECONDS) return { ok: false, reason: "invalid" };
  return { ok: true, expires };
}
