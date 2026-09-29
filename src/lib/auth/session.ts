import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import type { PublicUser, Role, Session, User } from "@/lib/types";
import { siteConfig } from "@/lib/config";
import { findById, findOne, getSettings, insert, mutate, removeWhere, update } from "@/lib/db/store";
import { uid } from "@/lib/utils";
import { mustSetUpTwoFactor } from "./account-status";

const COOKIE = siteConfig.sessionCookie;
const SESSION_MS = siteConfig.sessionDays * 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** SHA-256 hex of a raw session token (the form stored in `sessions.tokenHash`). */
export function hashSessionToken(token: string): string {
  return hashToken(token);
}

/**
 * Public-safe projection of a user. Besides the password hash it also drops
 * the account-security secrets (encrypted TOTP seed, replay step, recovery
 * code hashes) and the private calendar feed token, so profiles and lists
 * rendered for other people never carry them.
 */
export function toPublicUser(user: User): PublicUser {
  const {
    passwordHash: _omit,
    twoFactorSecretEnc: _secret,
    twoFactorLastStep: _step,
    recoveryCodeHashes: _codes,
    calendarToken: _calendar,
    ...rest
  } = user;
  void _omit;
  void _secret;
  void _step;
  void _codes;
  void _calendar;
  return rest;
}

/** Create a session for a user and set the auth cookie. */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const h = await headers();
  const session: Session = {
    id: uid("ses"),
    tokenHash: hashToken(token),
    userId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MS).toISOString(),
    userAgent: h.get("user-agent") ?? undefined,
  };
  await insert("sessions", session);
  await update("users", userId, { lastActiveAt: now.toISOString() });
  const store = await cookies();
  store.set({
    name: COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: siteConfig.cookieSecure,
    path: "/",
    maxAge: SESSION_MS / 1000,
  });
}

/** Remove the current session (and cookie). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    const tokenHash = hashToken(token);
    await removeWhere("sessions", (s) => s.tokenHash === tokenHash);
  }
  store.set({ name: COOKIE, value: "", path: "/", maxAge: 0 });
}

/** Log the user out everywhere. */
export async function destroyAllSessions(userId: string): Promise<void> {
  await removeWhere("sessions", (s) => s.userId === userId);
}

/** Hash of the session token in the current request's cookie (null when signed out). */
export async function getCurrentSessionTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/** Log the user out on every other device, keeping the current session. Returns how many were removed. */
export async function destroyOtherSessions(userId: string): Promise<number> {
  const current = await getCurrentSessionTokenHash();
  return removeWhere("sessions", (s) => s.userId === userId && s.tokenHash !== current);
}

/**
 * Resolve the logged-in user for this request. Memoized per request with
 * React `cache`, so calling it from layouts, pages and actions is free.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await findOne("sessions", (s) => s.tokenHash === tokenHash);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    await removeWhere("sessions", (s) => s.id === session.id);
    return null;
  }
  const user = await findById("users", session.userId);
  if (!user || !user.enabled) return null;
  return user;
});

export async function getCurrentPublicUser(): Promise<PublicUser | null> {
  const user = await getCurrentUser();
  return user ? toPublicUser(user) : null;
}

/* ------------------------------ Role helpers ------------------------------ */

export function hasRole(user: Pick<User, "roles"> | null | undefined, ...roles: Role[]): boolean {
  if (!user) return false;
  if (user.roles.includes("admin")) return true;
  return roles.some((r) => user.roles.includes(r));
}

export const isAdmin = (u: Pick<User, "roles"> | null | undefined) => !!u && u.roles.includes("admin");
/** Moderators and admins can manage all content. */
export const isModerator = (u: Pick<User, "roles"> | null | undefined) => hasRole(u, "moderator");
export const isCreator = (u: Pick<User, "roles"> | null | undefined) => hasRole(u, "course_creator", "moderator");
export const isEvaluator = (u: Pick<User, "roles"> | null | undefined) => hasRole(u, "batch_evaluator", "moderator");
/** Anyone with a staff-like role sees the admin area. */
export const isStaff = (u: Pick<User, "roles"> | null | undefined) =>
  hasRole(u, "course_creator", "moderator", "batch_evaluator");

/**
 * Staff who must turn on two-step verification (`settings.security.
 * enforceTwoFactorForStaff`) are sent to the security settings first, with the
 * page they wanted kept as `next`.
 */
async function enforceStaffTwoFactor(user: User, nextPath?: string): Promise<void> {
  const settings = await getSettings();
  if (!mustSetUpTwoFactor(user, settings.security)) return;
  const query = new URLSearchParams({ required: "2fa" });
  if (nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//")) query.set("next", nextPath);
  redirect(`/settings/security?${query.toString()}`);
}

/** Admin and teaching tools live under /admin; the enforce-2FA policy guards them. */
function isStaffAreaPath(nextPath?: string): boolean {
  return !!nextPath && (nextPath === "/admin" || nextPath.startsWith("/admin/") || nextPath.startsWith("/admin?"));
}

/**
 * Redirect to login when unauthenticated. `next` preserves the destination.
 * For `/admin…` destinations the enforce-2FA-for-staff policy also applies.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    const target = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
    redirect(target);
  }
  if (isStaffAreaPath(nextPath)) await enforceStaffTwoFactor(user, nextPath);
  return user;
}

/**
 * Require one of `roles`. When the platform enforces two-step verification for
 * staff, staff members who have not turned it on are sent to the security
 * settings to set it up first.
 */
export async function requireRole(roles: Role[], nextPath?: string): Promise<User> {
  const user = await requireUser(nextPath);
  if (!hasRole(user, ...roles)) redirect("/forbidden");
  if (!isStaffAreaPath(nextPath)) await enforceStaffTwoFactor(user, nextPath);
  return user;
}

/** Records a login-type activity once per day for streaks. */
export async function touchActivity(userId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await mutate((db) => {
    const exists = db.activities.some((a) => a.userId === userId && a.date === today && a.type === "login");
    if (!exists) {
      db.activities.push({
        id: uid("act"),
        userId,
        date: today,
        type: "login",
        createdAt: new Date().toISOString(),
      });
    }
  });
}
