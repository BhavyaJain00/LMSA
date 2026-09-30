import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Webhook signatures.
 *
 * Every delivery carries
 *
 *   LL-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + body)>
 *
 * where `body` is the exact bytes of the request body. Receivers recompute
 * the HMAC with the endpoint's signing secret, compare in constant time and
 * reject timestamps older than a few minutes (replay protection).
 *
 * `verifyWebhookSignature` is the reference implementation of the receiving
 * side: the developer docs show the same steps in other languages, and the
 * tests use it to check what the delivery worker sends.
 */

export const SIGNATURE_HEADER = "LL-Signature";
export const SIGNATURE_SCHEME = "v1";
/** Age after which receivers should refuse a signed request. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const WEBHOOK_SECRET_PREFIX = "whsec_";

const SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;
const HEX_SIGNATURE = /^[0-9a-f]{64}$/;
const MAX_HEADER_LENGTH = 1000;

/** A new signing secret: `whsec_` + 32 random bytes (base64url). */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function isWebhookSecret(value: unknown): value is string {
  return typeof value === "string" && SECRET_PATTERN.test(value);
}

/** Hex HMAC-SHA256 of `<timestamp>.<body>` keyed by the secret. */
export function computeSignature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

/** The `LL-Signature` header value for a body sent at `timestamp` (unix seconds). */
export function signatureHeader(secret: string, body: string, timestamp: number = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},${SIGNATURE_SCHEME}=${computeSignature(secret, timestamp, body)}`;
}

export interface ParsedSignature {
  timestamp: number;
  /** Every `v1` value in the header (more than one while a secret is being rotated). */
  signatures: string[];
}

/** Parse `t=…,v1=…`; null when the header is missing or malformed. Unknown schemes are ignored. */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header || header.length > MAX_HEADER_LENGTH) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) return null;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "t") {
      if (timestamp !== null || !/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (name === SIGNATURE_SCHEME) {
      const hex = value.toLowerCase();
      if (!HEX_SIGNATURE.test(hex)) return null;
      signatures.push(hex);
    }
  }
  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: "malformed" | "expired" | "mismatch" };

/**
 * Check a received `LL-Signature` header against the raw request body.
 * `now` is in milliseconds; timestamps more than `toleranceSeconds` away
 * from it (in either direction) are refused.
 */
export function verifyWebhookSignature(
  header: string | null | undefined,
  secret: string,
  body: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): SignatureCheck {
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(computeSignature(secret, parsed.timestamp, body), "hex");
  // Compare every candidate so the time taken does not depend on which one matched.
  let matched = false;
  for (const candidate of parsed.signatures) {
    const given = Buffer.from(candidate, "hex");
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  if (!matched) return { ok: false, reason: "mismatch" };
  const tolerance = opts.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((opts.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return { ok: false, reason: "expired" };
  return { ok: true, timestamp: parsed.timestamp };
}
