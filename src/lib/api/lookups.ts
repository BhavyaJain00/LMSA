import type { Batch, Course, Database, User } from "@/lib/types";
import { fieldError, notFound, validationError } from "./errors";
import { buildCourseStats, type CourseLookups } from "./serializers";

/**
 * Row lookups shared by the v1 route handlers. Each throws the matching
 * `ApiError` (404 / 400) so handlers read top to bottom.
 */

/** A course by id or slug. */
export function findCourse(db: Database, ref: string): Course {
  const course = db.courses.find((c) => c.id === ref) ?? db.courses.find((c) => c.slug === ref.toLowerCase());
  if (!course) throw notFound("course", ref);
  return course;
}

/** A batch by id or slug. */
export function findBatch(db: Database, ref: string): Batch {
  const batch = db.batches.find((b) => b.id === ref) ?? db.batches.find((b) => b.slug === ref.toLowerCase());
  if (!batch) throw notFound("batch", ref);
  return batch;
}

export function findUser(db: Database, id: string): User {
  const user = db.users.find((u) => u.id === id);
  if (!user) throw notFound("user", id);
  return user;
}

/**
 * The member a write refers to, by `userId` or `email` (the body schema
 * guarantees one of them). Sending both is allowed when they agree.
 */
export function resolveMember(db: Database, input: { userId?: string; email?: string }): User {
  const byId = input.userId ? db.users.find((u) => u.id === input.userId) : undefined;
  const byEmail = input.email ? db.users.find((u) => u.email.toLowerCase() === input.email) : undefined;
  if (input.userId && !byId) throw fieldError("userId", `No user with id "${input.userId}".`);
  if (input.email && !byEmail) throw fieldError("email", "No member has this email address. Create the member first with POST /api/v1/users.");
  if (byId && byEmail && byId.id !== byEmail.id) throw validationError({ userId: "userId and email belong to different members." });
  const user = byId ?? byEmail;
  if (!user) throw validationError({ userId: "Send userId or email." });
  return user;
}

export function userMap(db: Database): Map<string, User> {
  return new Map(db.users.map((u) => [u.id, u]));
}

/** Everything `serializeCourse` needs, computed once per request. */
export function courseLookups(db: Database, baseUrl: string): CourseLookups {
  return {
    baseUrl,
    users: userMap(db),
    categories: new Map(db.categories.map((c) => [c.id, c])),
    stats: buildCourseStats(db),
  };
}

/** Case-insensitive "contains" over several fields. */
export function matchesText(needle: string | undefined, ...fields: (string | undefined | null)[]): boolean {
  if (!needle) return true;
  const lower = needle.toLowerCase();
  return fields.some((field) => !!field && field.toLowerCase().includes(lower));
}
