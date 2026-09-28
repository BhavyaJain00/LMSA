import "server-only";
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: string, keylen: number, options: { N: number }) => Promise<Buffer>;

const KEY_LENGTH = 64;
const COST = 16384;

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
  if (!Number.isFinite(cost)) return false;
  const derived = await scrypt(password, salt, KEY_LENGTH, { N: cost });
  const expected = Buffer.from(hex, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain letters and numbers.";
  }
  return null;
}
