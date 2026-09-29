import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { checkPasswordPolicy, PASSWORD_MIN_LENGTH_FLOOR } from "./password-policy";

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number, options: { N: number }) => Promise<Buffer>;

const KEY_LENGTH = 64;
const COST = 16384;
/** Accepted scrypt cost range when verifying stored hashes (guards against absurd values). */
const MIN_COST = 1024;
const MAX_COST = 1 << 20;

/**
 * Hash a password with scrypt. Output format: `scrypt$N$salt$hash` (hex).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: COST });
  return `scrypt$${COST}$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, costStr, salt, hex] = stored.split("$");
  if (algo !== "scrypt" || !costStr || !salt || !hex) return false;
  const cost = Number(costStr);
  if (!Number.isInteger(cost) || cost < MIN_COST || cost > MAX_COST || (cost & (cost - 1)) !== 0) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: cost });
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

let dummyHash: Promise<string> | null = null;

/**
 * Verify against a real hash when the account exists, or burn the same scrypt
 * work against a throwaway hash when it doesn't, so response times don't
 * reveal which emails are registered. Always false for a missing hash.
 */
export async function verifyPasswordConstantTime(password: string, stored: string | null | undefined): Promise<boolean> {
  if (stored) return verifyPassword(password, stored);
  dummyHash ??= hashPassword(randomBytes(18).toString("base64url"));
  await verifyPassword(password, await dummyHash);
  return false;
}

/**
 * Validate a new password against the policy. `minLength` comes from
 * `settings.security.passwordMinLength` (defaults to 8).
 */
export function validatePasswordStrength(password: string, minLength: number = PASSWORD_MIN_LENGTH_FLOOR): string | null {
  return checkPasswordPolicy(password, minLength);
}
