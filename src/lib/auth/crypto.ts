import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getAppSecret } from "@/lib/server-env";

/**
 * Small cryptographic helpers shared by the account-security features.
 *
 * - Keys are derived from APP_SECRET with HKDF-SHA256 and a purpose label, so
 *   one application secret yields independent keys for each use.
 * - Secrets at rest (the TOTP seed) are sealed with AES-256-GCM; the purpose
 *   is bound as additional authenticated data so a ciphertext cannot be
 *   replayed into a different field.
 * - Every comparison of secret material is constant time.
 */

const ENCRYPTION_VERSION = "v1";
const HKDF_SALT = "learnloop.hkdf.v1";

/** SHA-256 hex digest. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Cryptographically random token, base64url encoded (32 bytes → 43 chars). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Constant-time string equality. Both sides are hashed first so the
 * comparison takes the same time regardless of length or content.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/** Derive a 32-byte key for a purpose from the application secret. */
export function deriveKey(purpose: string, secret: string = getAppSecret()): Buffer {
  if (!secret || secret.length < 32) throw new Error("A 32+ character application secret is required.");
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from(HKDF_SALT, "utf8"), Buffer.from(purpose, "utf8"), 32));
}

/** HMAC-SHA256 (hex) keyed by a purpose-specific key. */
export function hmacHex(purpose: string, value: string, secret?: string): string {
  return createHmac("sha256", deriveKey(`hmac:${purpose}`, secret)).update(value, "utf8").digest("hex");
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts).
 */
export function encryptString(plain: string, purpose: string, secret?: string): string {
  const key = deriveKey(`enc:${purpose}`, secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/**
 * Decrypt a value produced by `encryptString`. Fails closed: returns null for
 * any malformed, tampered or wrongly keyed payload (never throws).
 */
export function decryptString(payload: string | undefined | null, purpose: string, secret?: string): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const ciphertext = Buffer.from(parts[3]!, "base64url");
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(`enc:${purpose}`, secret), iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
