import "server-only";
import { randomBytes } from "node:crypto";
import type { ApiKey } from "@/lib/types";
import { safeEqual, sha256Hex } from "@/lib/auth/crypto";

/**
 * API key format, hashing and lookup.
 *
 * A key looks like `ll_live_<id>_<secret>`:
 *  - `<id>`: 10 lowercase letters/digits. `ll_live_<id>` is stored as the
 *    key's `prefix`, shown in the admin list and used to find the row;
 *  - `<secret>`: 40 base62 characters (~238 bits of randomness).
 *
 * The full key is shown once when it is created. Only its SHA-256 hash is
 * stored (a salted slow hash adds nothing for a random 238-bit secret), and
 * hashes are compared in constant time.
 */

export const API_KEY_NAMESPACE = "ll_live_";

const ID_LENGTH = 10;
const SECRET_LENGTH = 40;
const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SECRET_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const KEY_PATTERN = new RegExp(`^${API_KEY_NAMESPACE}([a-z0-9]{${ID_LENGTH}})_([A-Za-z0-9]{${SECRET_LENGTH}})$`);
/** Longest header value worth looking at (a key is 59 characters). */
const MAX_TOKEN_LENGTH = 200;

/** Uniformly random string over `alphabet` (rejection sampling avoids modulo bias). */
function randomString(alphabet: string, length: number): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function hashApiKey(key: string): string {
  return sha256Hex(key);
}

export interface GeneratedApiKey {
  /** The full key: show it once, never store it. */
  key: string;
  /** `ll_live_<id>`: stored and displayed. */
  prefix: string;
  keyHash: string;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = `${API_KEY_NAMESPACE}${randomString(ID_ALPHABET, ID_LENGTH)}`;
  const key = `${prefix}_${randomString(SECRET_ALPHABET, SECRET_LENGTH)}`;
  return { key, prefix, keyHash: hashApiKey(key) };
}

/** Split a key into its stored prefix and secret, or null when it is not a well-formed key. */
export function parseApiKey(raw: string | null | undefined): { prefix: string; secret: string } | null {
  if (!raw || raw.length > MAX_TOKEN_LENGTH) return null;
  const match = KEY_PATTERN.exec(raw);
  if (!match) return null;
  return { prefix: `${API_KEY_NAMESPACE}${match[1]}`, secret: match[2]! };
}

/** The token of an `Authorization: Bearer <token>` header, or null. */
export function readBearerToken(header: string | null | undefined): string | null {
  if (!header || header.length > MAX_TOKEN_LENGTH + 20) return null;
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1]! : null;
}

/** `ll_live_abcd123456_••••` for display. */
export function maskApiKey(prefix: string): string {
  return `${prefix}_${"•".repeat(8)}`;
}

export type KeyMatch = { status: "valid"; key: ApiKey } | { status: "revoked"; key: ApiKey } | { status: "invalid" };

/**
 * Find the stored key for a presented token. The hash is always computed and
 * compared in constant time, so a wrong secret for a known prefix takes as
 * long as an unknown prefix.
 */
export function matchApiKey(keys: readonly ApiKey[], token: string | null | undefined): KeyMatch {
  const parsed = parseApiKey(token);
  const hash = hashApiKey(parsed ? token! : "");
  if (!parsed) return { status: "invalid" };
  const row = keys.find((k) => k.prefix === parsed.prefix);
  // Compare against a dummy hash when the prefix is unknown so both paths do the same work.
  const matches = safeEqual(hash, row?.keyHash ?? hashApiKey(`${parsed.prefix}_unknown`));
  if (!row || !matches) return { status: "invalid" };
  if (row.revokedAt) return { status: "revoked", key: row };
  return { status: "valid", key: row };
}
