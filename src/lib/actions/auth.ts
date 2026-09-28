"use server";

import { redirect } from "next/navigation";
import type { ActionResult, User } from "@/lib/types";
import { getDb, insert, update } from "@/lib/db/store";
import { hashPassword, validatePasswordStrength, verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getCurrentUser, touchActivity } from "@/lib/auth/session";
import { getUserByEmail, getUserByUsername } from "@/lib/data/users";
import { evaluateBadges } from "@/lib/services/badges";
import { fd, isValidEmail, slugify, uid } from "@/lib/utils";
import { setFlash } from "@/lib/flash";

function safeNext(next: string | undefined | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = safeNext(fd(formData, "next"));

  if (!email || !password) return { ok: false, error: "Please enter your email and password." };
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return { ok: false, error: "Incorrect email or password." };
  }
  if (!user.enabled) return { ok: false, error: "This account has been disabled. Contact support." };

  await createSession(user.id);
  await touchActivity(user.id);
  redirect(next === "/" ? defaultHomeFor(user) : next);
}

function defaultHomeFor(user: User): string {
  if (user.roles.some((r) => r === "admin" || r === "moderator" || r === "course_creator")) return "/dashboard";
  return "/dashboard";
}

export async function registerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const db = await getDb();
  if (db.settings.learning.disableSignup) return { ok: false, error: "Sign up is disabled. Ask an administrator for an account." };

  const name = fd(formData, "name");
  const email = fd(formData, "email").toLowerCase();
  const password = fd(formData, "password");
  const next = safeNext(fd(formData, "next"));

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Please enter your full name.";
  if (!isValidEmail(email)) fieldErrors.email = "Please enter a valid email address.";
  const pwErr = validatePasswordStrength(password);
  if (pwErr) fieldErrors.password = pwErr;
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Please fix the errors below.", fieldErrors };

  if (await getUserByEmail(email)) return { ok: false, error: "An account with this email already exists.", fieldErrors: { email: "Already registered" } };

  // Derive a unique username from the email local part.
  let username = slugify(email.split("@")[0] ?? name) || "user";
  let suffix = 1;
  while (await getUserByUsername(username)) username = `${slugify(email.split("@")[0] ?? name)}-${++suffix}`;

  const user: User = {
    id: uid("usr"),
    username,
    name,
    email,
    passwordHash: await hashPassword(password),
    roles: ["student"],
    enabled: true,
    personaCaptured: false,
    createdAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
  };
  await insert("users", user);
  await createSession(user.id);
  await touchActivity(user.id);
  await evaluateBadges(user.id, "manual");
  await setFlash(`Welcome to the platform, ${user.name.split(" ")[0]}!`);
  redirect(next === "/" ? "/persona" : next);
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const current = fd(formData, "current");
  const next = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  if (!(await verifyPassword(current, user.passwordHash))) return { ok: false, error: "Current password is incorrect.", fieldErrors: { current: "Incorrect" } };
  const pwErr = validatePasswordStrength(next);
  if (pwErr) return { ok: false, error: pwErr, fieldErrors: { password: pwErr } };
  if (next !== confirm) return { ok: false, error: "Passwords do not match.", fieldErrors: { confirm: "Does not match" } };
  await update("users", user.id, { passwordHash: await hashPassword(next) });
  return { ok: true, data: undefined, message: "Password updated." };
}
