import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238) on top of HOTP (RFC 4226).
 *
 * Parameters match what every authenticator app expects by default:
 * HMAC-SHA1, 30-second steps, 6 digits. Verification accepts the previous,
 * current and next step (±30 s clock drift) and refuses any step at or
 * before the last accepted one, so an observed code cannot be replayed.
 *
 * Pure module (Node crypto only) so it can be unit-tested in isolation.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 (no padding). */
export function base32Encode(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

/** Decode base32, ignoring case, spaces, dashes and padding. Returns null on invalid input. */
export function base32Decode(input: string): Buffer | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
    buffer &= (1 << bits) - 1;
  }
  return Buffer.from(out);
}

/** A new random secret (160 bits, the RFC 4226 recommendation), base32 encoded. */
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

/** Group a base32 secret in blocks of four for manual entry. */
export function formatSecretForDisplay(secret: string): string {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

/** HOTP value for a counter (RFC 4226 §5.3 dynamic truncation). */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.max(0, Math.floor(counter))));
  const hmac = createHmac("sha1", key).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** Time step for a Unix time in milliseconds. */
export function totpStep(nowMs: number = Date.now(), period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / period);
}

/** The TOTP code for a base32 secret at a given time. */
export function totpCode(secret: string, nowMs: number = Date.now(), digits = TOTP_DIGITS): string {
  const key = base32Decode(secret);
  if (!key) throw new Error("Invalid base32 secret.");
  return hotp(key, totpStep(nowMs), digits);
}

/** Strip spaces/dashes a user may type; returns null unless exactly `digits` digits. */
export function normalizeTotpInput(code: string, digits = TOTP_DIGITS): string | null {
  const clean = code.replace(/[\s-]/g, "");
  return new RegExp(`^\\d{${digits}}$`).test(clean) ? clean : null;
}

export interface TotpVerifyOptions {
  nowMs?: number;
  /** Accepted steps on either side of the current one. */
  window?: number;
  /** Last step that was accepted for this secret (replay protection). */
  lastStep?: number;
}

/**
 * Verify a code. Returns the matched time step (store it as the new
 * `lastStep`) or null. All candidate steps are compared in constant time.
 */
export function verifyTotp(secret: string, code: string, options: TotpVerifyOptions = {}): number | null {
  const key = base32Decode(secret);
  const input = normalizeTotpInput(code);
  if (!key || !input) return null;
  const current = totpStep(options.nowMs ?? Date.now());
  const window = Math.max(0, options.window ?? TOTP_WINDOW);
  const given = Buffer.from(input, "utf8");
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step++) {
    const expected = Buffer.from(hotp(key, step), "utf8");
    const equal = timingSafeEqual(expected, given);
    if (equal && matched === null && (options.lastStep === undefined || step > options.lastStep)) matched = step;
  }
  return matched;
}

/**
 * `otpauth://totp/Issuer:account?secret=…&issuer=…` (Key URI format used by
 * Google Authenticator, 1Password, Authy, Microsoft Authenticator…).
 */
export function buildOtpauthUri({ issuer, account, secret }: { issuer: string; account: string; secret: string }): string {
  const cleanIssuer = issuer.replace(/:/g, "").trim() || "LearnLoop";
  const label = `${encodeURIComponent(cleanIssuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer: cleanIssuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString().replace(/\+/g, "%20")}`;
}
