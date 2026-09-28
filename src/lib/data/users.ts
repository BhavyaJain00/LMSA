import "server-only";
import type { PublicUser, User } from "@/lib/types";
import { all, findById, findOne } from "@/lib/db/store";
import { toPublicUser } from "@/lib/auth/session";

export async function getPublicUser(id: string | undefined | null): Promise<PublicUser | null> {
  const user = await findById("users", id);
  return user ? toPublicUser(user) : null;
}

export async function getPublicUsers(ids: string[]): Promise<PublicUser[]> {
  if (!ids.length) return [];
  const set = new Set(ids);
  const users = await all("users");
  const byId = new Map(users.filter((u) => set.has(u.id)).map((u) => [u.id, toPublicUser(u)]));
  // Preserve the order of `ids`.
  return ids.map((id) => byId.get(id)).filter((u): u is PublicUser => !!u);
}

/** Map of id → public user for quick lookups when rendering lists. */
export async function getUserMap(ids?: string[]): Promise<Map<string, PublicUser>> {
  const users = await all("users");
  const set = ids ? new Set(ids) : null;
  return new Map(users.filter((u) => !set || set.has(u.id)).map((u) => [u.id, toPublicUser(u)]));
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const lower = username.toLowerCase();
  return findOne("users", (u) => u.username.toLowerCase() === lower);
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const lower = email.trim().toLowerCase();
  return findOne("users", (u) => u.email.toLowerCase() === lower);
}

export async function listUsers(): Promise<PublicUser[]> {
  const users = await all("users");
  return users.map(toPublicUser).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listInstructors(): Promise<PublicUser[]> {
  const users = await all("users");
  return users
    .filter((u) => u.roles.some((r) => r === "course_creator" || r === "moderator" || r === "admin"))
    .map(toPublicUser)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listEvaluators(): Promise<PublicUser[]> {
  const users = await all("users");
  return users
    .filter((u) => u.roles.some((r) => r === "batch_evaluator" || r === "moderator" || r === "admin"))
    .map(toPublicUser)
    .sort((a, b) => a.name.localeCompare(b.name));
}
