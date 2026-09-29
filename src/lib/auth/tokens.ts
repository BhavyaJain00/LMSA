import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthToken, AuthTokenPurpose, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { uid } from "@/lib/utils";

/**
 * Single-use account tokens (password reset, email verification, 2FA sign-in
 * challenge).
 *
 * - The raw token is 32 random bytes, base64url encoded (43 characters). It is
 *   only ever sent to the user (email link or httpOnly cookie); the database
 *   stores its SHA-256 hex digest.
 * - Tokens expire (reset 1 h, verification 24 h, 2FA challenge 10 min) and are
 *   consumed atomically inside `mutate`, so a token can be used exactly once
 *   even under concurrent requests.
 * - Issuing a new token deletes the user's older unused tokens of the same
 *   purpose, so only the latest link works.
 */

export const AUTH_TOKEN_TTL_MS: Record<AuthTokenPurpose, number> = {
  password_reset: 60 * 60 * 1000,
  email_verification: 24 * 60 * 60 * 1000,
  two_factor_login: 10 * 60 * 1000,
};

/** Used/expired rows are kept this long (for troubleshooting), then purged. */
const HOUSEKEEPING_MS = 7 * 24 * 60 * 60 * 1000;

const RAW_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex of the raw token — the only form that is stored. */
export function hashAuthToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Whether a string could be a token we issued (cheap pre-check before any lookup). */
export function isWellFormedToken(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && RAW_TOKEN_PATTERN.test(raw);
}

function hexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export type TokenState = "valid" | "used" | "expired";

/** Pure state check for a stored token. */
export function tokenState(token: Pick<AuthToken, "usedAt" | "expiresAt">, now: number = Date.now()): TokenState {
  if (token.usedAt) return "used";
  const expires = new Date(token.expiresAt).getTime();
  if (Number.isNaN(expires) || expires <= now) return "expired";
  return "valid";
}

/** Find the stored row for a raw token (constant-time comparison over the candidate rows). */
function findTokenRow(rows: AuthToken[], raw: string, purpose: AuthTokenPurpose): AuthToken | null {
  const hash = hashAuthToken(raw);
  let match: AuthToken | null = null;
  for (const row of rows) {
    if (row.purpose !== purpose) continue;
    if (hexEqual(row.tokenHash, hash) && !match) match = row;
  }
  return match;
}

export interface IssuedToken {
  /** Raw token to deliver to the user. Never store or log it. */
  token: string;
  record: AuthToken;
}

/** Issue a new token, invalidating the user's older unused tokens of the same purpose. */
export async function issueAuthToken(userId: string, purpose: AuthTokenPurpose, now: Date = new Date()): Promise<IssuedToken> {
  const token = generateRawToken();
  const record: AuthToken = {
    id: uid("atk"),
    userId,
    purpose,
    tokenHash: hashAuthToken(token),
    expiresAt: new Date(now.getTime() + AUTH_TOKEN_TTL_MS[purpose]).toISOString(),
    createdAt: now.toISOString(),
  };
  const nowMs = now.getTime();
  await mutate((db) => {
    db.authTokens = db.authTokens.filter((t) => {
      // Older unused tokens of the same purpose stop working.
      if (t.userId === userId && t.purpose === purpose && !t.usedAt) return false;
      // Housekeeping: drop rows that have been dead for a while.
      const dead = t.usedAt ? new Date(t.usedAt).getTime() : new Date(t.expiresAt).getTime();
      return !(tokenState(t, nowMs) !== "valid" && dead < nowMs - HOUSEKEEPING_MS);
    });
    db.authTokens.push(record);
  });
  return { token, record };
}

export interface TokenLookup {
  token: AuthToken;
  user: User;
}

export type TokenCheck = ({ status: "valid" } & TokenLookup) | { status: "invalid" | "used" | "expired"; user?: User };

/**
 * Look a token up without consuming it (e.g. to render the reset form).
 * Tokens of disabled or deleted users are reported as invalid.
 */
export async function checkAuthToken(raw: string | null | undefined, purpose: AuthTokenPurpose, now: number = Date.now()): Promise<TokenCheck> {
  if (!isWellFormedToken(raw)) return { status: "invalid" };
  const db = await getDb();
  const row = findTokenRow(db.authTokens, raw, purpose);
  if (!row) return { status: "invalid" };
  const user = db.users.find((u) => u.id === row.userId);
  if (!user || !user.enabled) return { status: "invalid" };
  const state = tokenState(row, now);
  if (state !== "valid") return { status: state, user };
  return { status: "valid", token: row, user };
}

/**
 * Atomically validate and mark a token used. Returns null when the token is
 * unknown, expired, already used, or belongs to a disabled/deleted account.
 */
export async function consumeAuthToken(raw: string | null | undefined, purpose: AuthTokenPurpose, now: Date = new Date()): Promise<TokenLookup | null> {
  if (!isWellFormedToken(raw)) return null;
  return mutate((db) => {
    const row = findTokenRow(db.authTokens, raw, purpose);
    if (!row || tokenState(row, now.getTime()) !== "valid") return null;
    const user = db.users.find((u) => u.id === row.userId);
    if (!user || !user.enabled) return null;
    row.usedAt = now.toISOString();
    return { token: { ...row }, user };
  });
}

/** Revoke (delete) a user's unused tokens, optionally for one purpose. */
export async function revokeAuthTokens(userId: string, purpose?: AuthTokenPurpose): Promise<number> {
  return mutate((db) => {
    const before = db.authTokens.length;
    db.authTokens = db.authTokens.filter((t) => !(t.userId === userId && !t.usedAt && (!purpose || t.purpose === purpose)));
    return before - db.authTokens.length;
  });
}

/** Revoke one specific token by its raw value (e.g. when a 2FA challenge is cancelled). */
export async function revokeAuthToken(raw: string | null | undefined, purpose: AuthTokenPurpose): Promise<boolean> {
  if (!isWellFormedToken(raw)) return false;
  return mutate((db) => {
    const row = findTokenRow(db.authTokens, raw, purpose);
    if (!row || row.usedAt) return false;
    db.authTokens = db.authTokens.filter((t) => t.id !== row.id);
    return true;
  });
}
