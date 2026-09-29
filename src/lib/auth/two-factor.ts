import "server-only";
import { randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { mutate } from "@/lib/db/store";
import { decryptString, encryptString, hmacHex } from "./crypto";
import { AUTH_TOKEN_TTL_MS } from "./tokens";
import { buildOtpauthUri, generateTotpSecret, normalizeTotpInput, verifyTotp } from "./totp";

/**
 * Two-step verification (TOTP, RFC 6238) and recovery codes.
 *
 * - The base32 secret is sealed with AES-256-GCM (key derived from APP_SECRET)
 *   in `twoFactorSecretEnc`; it is decrypted only to verify a code or to show
 *   the QR code during setup.
 * - Codes are accepted for the previous/current/next 30-second step and a step
 *   can only be used once (`twoFactorLastStep`).
 * - Ten single-use recovery codes are shown once; only their HMAC-SHA256
 *   (keyed from APP_SECRET) is stored in `recoveryCodeHashes`.
 * - Every verification that changes state runs inside `mutate`, so two
 *   concurrent requests can never both accept the same code.
 */

const SECRET_PURPOSE = "totp-secret";
const RECOVERY_PURPOSE = "recovery-code";

export const RECOVERY_CODE_COUNT = 10;
/** Unambiguous lowercase alphabet (no 0/o, 1/l/i). */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const RECOVERY_GROUP = 5;

/* ------------------------------------------------------------------ */
/* Secret storage                                                       */
/* ------------------------------------------------------------------ */

export function sealTotpSecret(secret: string): string {
  return encryptString(secret, SECRET_PURPOSE);
}

/** Decrypt the stored secret; null when missing, tampered or keyed with another APP_SECRET. */
export function openTotpSecret(user: Pick<User, "twoFactorSecretEnc">): string | null {
  return decryptString(user.twoFactorSecretEnc, SECRET_PURPOSE);
}

export function newTotpSecret(): string {
  return generateTotpSecret();
}

export function otpauthUriFor(user: Pick<User, "email">, secret: string, issuer: string): string {
  return buildOtpauthUri({ issuer, account: user.email, secret });
}

/* ------------------------------------------------------------------ */
/* Recovery codes                                                       */
/* ------------------------------------------------------------------ */

/** "k7m2p-xq9ha" — ten characters from a 31-letter alphabet (~49 bits each). */
export function generateRecoveryCodes(count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let raw = "";
    for (let i = 0; i < RECOVERY_GROUP * 2; i++) raw += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    codes.add(`${raw.slice(0, RECOVERY_GROUP)}-${raw.slice(RECOVERY_GROUP)}`);
  }
  return [...codes];
}

/** Lower-case, strip spaces/dashes; null unless it has the shape of a recovery code. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toLowerCase().replace(/[\s-]/g, "");
  if (clean.length !== RECOVERY_GROUP * 2) return null;
  for (const ch of clean) if (!RECOVERY_ALPHABET.includes(ch)) return null;
  return clean;
}

export function hashRecoveryCode(code: string): string {
  const normalized = normalizeRecoveryCode(code) ?? code;
  return hmacHex(RECOVERY_PURPOSE, normalized);
}

/**
 * Index of the stored hash matching `input`, or -1. Compares against every
 * stored hash in constant time (no early exit).
 */
export function findRecoveryCodeIndex(hashes: readonly string[] | undefined, input: string): number {
  const normalized = normalizeRecoveryCode(input);
  if (!normalized || !hashes?.length) return -1;
  const candidate = Buffer.from(hmacHex(RECOVERY_PURPOSE, normalized), "hex");
  let found = -1;
  hashes.forEach((stored, i) => {
    const buf = Buffer.from(stored, "hex");
    const equal = buf.length === candidate.length && timingSafeEqual(buf, candidate);
    if (equal && found === -1) found = i;
  });
  return found;
}

/* ------------------------------------------------------------------ */
/* Verification                                                         */
/* ------------------------------------------------------------------ */

export type SecondFactorMethod = "totp" | "recovery";

export type SecondFactorResult =
  { ok: true; method: "totp"; step: number } | { ok: true; method: "recovery"; remaining: number } | { ok: false; reason: "invalid_code" | "not_enabled" | "unreadable_secret" };

export interface SecondFactorInput {
  method: SecondFactorMethod;
  code: string;
}

/**
 * Verify a TOTP or recovery code for an account and record its use
 * atomically (advance `twoFactorLastStep` / delete the recovery code).
 * `requireEnabled: false` is used while confirming a pending setup.
 */
export async function consumeSecondFactor(userId: string, input: SecondFactorInput, options: { requireEnabled?: boolean; nowMs?: number } = {}): Promise<SecondFactorResult> {
  const requireEnabled = options.requireEnabled ?? true;
  return mutate((db): SecondFactorResult => {
    const user = db.users.find((u) => u.id === userId);
    if (!user || !user.twoFactorSecretEnc) return { ok: false, reason: "not_enabled" };
    if (requireEnabled && user.twoFactorEnabled !== true) return { ok: false, reason: "not_enabled" };

    if (input.method === "recovery") {
      if (!requireEnabled) return { ok: false, reason: "invalid_code" };
      const index = findRecoveryCodeIndex(user.recoveryCodeHashes, input.code);
      if (index === -1) return { ok: false, reason: "invalid_code" };
      user.recoveryCodeHashes = (user.recoveryCodeHashes ?? []).filter((_, i) => i !== index);
      return { ok: true, method: "recovery", remaining: user.recoveryCodeHashes.length };
    }

    const secret = openTotpSecret(user);
    if (!secret) return { ok: false, reason: "unreadable_secret" };
    if (!normalizeTotpInput(input.code)) return { ok: false, reason: "invalid_code" };
    const step = verifyTotp(secret, input.code, { nowMs: options.nowMs, lastStep: user.twoFactorLastStep });
    if (step === null) return { ok: false, reason: "invalid_code" };
    user.twoFactorLastStep = step;
    return { ok: true, method: "totp", step };
  });
}

export type ConfirmSetupResult = { ok: true; step: number } | { ok: false; reason: "invalid_code" | "changed" | "unreadable_secret" };

/**
 * Confirm a pending setup: verify the code against the pending secret and
 * turn two-step verification on — in one serialized `mutate`, so a setup
 * restarted in another tab can never slip in between (2FA would otherwise be
 * enabled with a secret the member never confirmed). `expectedSecretEnc` is
 * the sealed secret the request started with; if the pending secret has been
 * replaced (or setup cancelled / already finished) nothing changes.
 */
export async function confirmTwoFactorSetup(
  userId: string,
  code: string,
  expectedSecretEnc: string,
  recoveryCodeHashes: string[],
  options: { nowMs?: number } = {},
): Promise<ConfirmSetupResult> {
  return mutate((db): ConfirmSetupResult => {
    const user = db.users.find((u) => u.id === userId);
    if (!user || user.twoFactorEnabled === true || !user.twoFactorSecretEnc || user.twoFactorSecretEnc !== expectedSecretEnc) {
      return { ok: false, reason: "changed" };
    }
    const secret = openTotpSecret(user);
    if (!secret) return { ok: false, reason: "unreadable_secret" };
    const step = verifyTotp(secret, code, { nowMs: options.nowMs, lastStep: user.twoFactorLastStep });
    if (step === null) return { ok: false, reason: "invalid_code" };
    user.twoFactorLastStep = step;
    user.twoFactorEnabled = true;
    user.recoveryCodeHashes = [...recoveryCodeHashes];
    return { ok: true, step };
  });
}

/** Read the method + code fields posted by the second-factor forms. */
export function readSecondFactorInput(formData: FormData): SecondFactorInput {
  const method = formData.get("method") === "recovery" ? "recovery" : "totp";
  const raw = formData.get(method === "recovery" ? "recoveryCode" : "code");
  return { method, code: typeof raw === "string" ? raw.trim().slice(0, 64) : "" };
}

/* ------------------------------------------------------------------ */
/* Sign-in challenge cookie                                              */
/* ------------------------------------------------------------------ */

/** httpOnly cookie carrying the raw `two_factor_login` token between the password and code steps. */
export const TWO_FACTOR_COOKIE = `${siteConfig.sessionCookie}_2fa`;

export async function setTwoFactorChallengeCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: TWO_FACTOR_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: siteConfig.cookieSecure,
    path: "/",
    maxAge: Math.floor(AUTH_TOKEN_TTL_MS.two_factor_login / 1000),
  });
}

export async function readTwoFactorChallengeCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(TWO_FACTOR_COOKIE)?.value ?? null;
}

/** Only callable from Server Actions / Route Handlers. */
export async function clearTwoFactorChallengeCookie(): Promise<void> {
  const store = await cookies();
  store.set({ name: TWO_FACTOR_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, sameSite: "lax", secure: siteConfig.cookieSecure });
}
