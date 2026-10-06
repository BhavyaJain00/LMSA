import "server-only";
import { revalidatePath } from "next/cache";
import type { Database, Role, User } from "@/lib/types";
import { mutate } from "@/lib/db/store";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { randomToken } from "@/lib/auth/crypto";
import { issueAuthToken } from "@/lib/auth/tokens";
import { sendPasswordResetEmail } from "@/lib/auth/emails";
import { destroyAllSessions } from "@/lib/auth/session";
import { sendWelcomeEmail } from "@/lib/email";
import { emit } from "@/lib/events";
import { slugify, uid } from "@/lib/utils";
import type { endpoints } from "./endpoints";
import { conflict, fieldError, forbidden, notFound } from "./errors";
import type { Infer } from "./schema";

/**
 * Member writes through the API (POST /users, PATCH /users/{id}).
 *
 * Same rules as Admin → Members: unique email and username, the site's
 * password policy, and the admin role is never granted or taken away
 * through the API. Administrator accounts keep their email, roles and
 * status (an API key must not be able to lock admins out).
 */

export type CreateUserInput = Infer<(typeof endpoints)["createUser"]["body"]>;
export type UpdateUserInput = Infer<(typeof endpoints)["updateUser"]["body"]>;

/** A free username derived from the email (or name); `taken` holds lower-cased usernames. */
export function deriveUsername(email: string, name: string, taken: ReadonlySet<string>): string {
  const base = slugify(email.split("@")[0] || name).slice(0, 36).replace(/-+$/, "") || "member";
  const padded = base.length < 3 ? `${base}-member` : base;
  let username = padded;
  for (let i = 2; taken.has(username); i++) username = `${padded}-${i}`;
  return username;
}

function emailTaken(db: Database, email: string, exceptId?: string): boolean {
  return db.users.some((u) => u.id !== exceptId && u.email.toLowerCase() === email);
}

function usernameTaken(db: Database, username: string, exceptId?: string): boolean {
  return db.users.some((u) => u.id !== exceptId && u.username.toLowerCase() === username);
}

function text(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export interface CreatedMember {
  user: User;
  /** A set-password link was emailed (no password was given). */
  passwordLinkSent: boolean;
}

export async function createMember(db: Database, input: CreateUserInput): Promise<CreatedMember> {
  if (emailTaken(db, input.email)) throw conflict("A member with this email already exists.", { email: "A member with this email already exists." });
  if (input.username && usernameTaken(db, input.username)) throw conflict("This username is taken.", { username: "This username is taken." });
  if (input.password !== undefined) {
    const problem = validatePasswordStrength(input.password, db.settings.security.passwordMinLength);
    if (problem) throw fieldError("password", problem);
  }
  // Without a password the account gets a long random one nobody knows; the member sets their own from the emailed link.
  const passwordHash = await hashPassword(input.password ?? randomToken(32));
  const roles: Role[] = input.roles?.length ? [...input.roles] : ["student"];

  const user = await mutate((d): User | "email" | "username" => {
    if (emailTaken(d, input.email)) return "email";
    const taken = new Set(d.users.map((u) => u.username.toLowerCase()));
    if (input.username && taken.has(input.username)) return "username";
    const now = new Date().toISOString();
    const row: User = {
      id: uid("usr"),
      username: input.username || deriveUsername(input.email, input.name, taken),
      name: input.name.replace(/\s+/g, " "),
      email: input.email,
      passwordHash,
      roles,
      headline: text(input.headline),
      location: text(input.location),
      bio: text(input.bio),
      enabled: true,
      personaCaptured: false,
      createdAt: now,
      updatedAt: now,
    };
    d.users.push(row);
    return row;
  });
  if (user === "email") throw conflict("A member with this email already exists.", { email: "A member with this email already exists." });
  if (user === "username") throw conflict("This username is taken.", { username: "This username is taken." });

  emit("user.registered", { userId: user.id, email: user.email, name: user.name, source: "admin" });
  let passwordLinkSent = false;
  if (input.sendWelcomeEmail ?? true) {
    try {
      await sendWelcomeEmail(user);
      if (input.password === undefined) {
        const issued = await issueAuthToken(user.id, "password_reset");
        await sendPasswordResetEmail(user, issued.token);
        passwordLinkSent = true;
      }
    } catch (error) {
      console.error("[api] could not queue the welcome email:", error instanceof Error ? error.message : String(error));
    }
  }
  revalidatePath("/admin/members");
  return { user, passwordLinkSent };
}

export interface UpdatedMember {
  user: User;
  /** Names of the fields that changed. */
  changed: string[];
}

export async function updateMember(db: Database, id: string, input: UpdateUserInput): Promise<UpdatedMember> {
  const target = db.users.find((u) => u.id === id);
  if (!target) throw notFound("user", id);
  const isAdminAccount = target.roles.includes("admin");
  if (isAdminAccount && (input.email !== undefined || input.roles !== undefined || input.enabled !== undefined)) {
    throw forbidden("Administrator accounts can't have their email, roles or status changed through the API. Use Admin → Members.");
  }
  if (input.email !== undefined && emailTaken(db, input.email, id)) throw conflict("A member with this email already exists.", { email: "A member with this email already exists." });
  if (input.username !== undefined && usernameTaken(db, input.username, id)) throw conflict("This username is taken.", { username: "This username is taken." });

  const result = await mutate((d): UpdatedMember | "missing" | "email" | "username" => {
    const row = d.users.find((u) => u.id === id);
    if (!row) return "missing";
    if (input.email !== undefined && emailTaken(d, input.email, id)) return "email";
    if (input.username !== undefined && usernameTaken(d, input.username, id)) return "username";
    const before = { ...row };
    if (input.name !== undefined) row.name = input.name.replace(/\s+/g, " ");
    if (input.username !== undefined) row.username = input.username;
    if (input.email !== undefined && input.email !== row.email.toLowerCase()) {
      row.email = input.email;
      // A new address has not been confirmed by its owner.
      row.emailVerifiedAt = undefined;
    }
    if (input.headline !== undefined) row.headline = text(input.headline);
    if (input.location !== undefined) row.location = text(input.location);
    if (input.bio !== undefined) row.bio = text(input.bio);
    if (input.roles !== undefined) row.roles = input.roles.length ? [...input.roles] : ["student"];
    if (input.enabled !== undefined) row.enabled = input.enabled;
    const changed = (Object.keys(input) as (keyof UpdateUserInput)[]).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(row[key]));
    // Lets `updated_since` sync pick the change up (an email change also clears emailVerifiedAt, which would move the stamp backwards).
    if (changed.length) row.updatedAt = new Date().toISOString();
    return { user: { ...row }, changed };
  });
  if (result === "missing") throw notFound("user", id);
  if (result === "email") throw conflict("A member with this email already exists.", { email: "A member with this email already exists." });
  if (result === "username") throw conflict("This username is taken.", { username: "This username is taken." });

  if (input.enabled === false && target.enabled) await destroyAllSessions(id);
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${id}`);
  revalidatePath(`/user/${result.user.username}`);
  if (target.username !== result.user.username) revalidatePath(`/user/${target.username}`);
  return result;
}
