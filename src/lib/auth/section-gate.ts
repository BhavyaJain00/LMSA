import "server-only";
import { redirect } from "next/navigation";
import type { Role, User } from "@/lib/types";
import { getCurrentUser, hasRole } from "./session";

/**
 * Role gates for SECTION LAYOUTS (`/admin/affiliates/layout.tsx`, …).
 *
 * Most sections have a `loading.tsx`, so their pages render inside a Suspense
 * boundary: by the time a page calls `requireRole`, the response has already
 * started streaming as `200` and the redirect to `/forbidden` happens in the
 * browser. A layout renders OUTSIDE its own segment's loading boundary, so the
 * same check made there becomes a real `307` before anything streams.
 *
 * The gate only turns signed-in members without the role away. Guests are left
 * to the proxy (a real `307 → /login?next=…` for every login-only page) and to
 * the page itself, which knows the exact return path and applies the staff
 * two-step verification rule. Every page and Server Action keeps its own check:
 * layouts do not re-render on client navigation, so they are never the only
 * line of defence.
 *
 * A gate must never be stricter than any page below it: `tests/core-section-gates.test.ts`
 * checks that every page under a `gateSection` layout requires a subset of the
 * layout's roles, that every page under a `gateSectionWith` layout makes the
 * same check with the same redirect, and that no `loading.tsx` above the
 * layout would make the gate stream.
 */

/** Where a signed-in member is sent when they lack every one of `roles` (admins pass every gate). */
export function sectionGateRedirect(user: Pick<User, "roles"> | null, roles: readonly Role[]): "/forbidden" | null {
  if (!user) return null;
  return hasRole(user, ...roles) ? null : "/forbidden";
}

/** Redirect (a real 307) signed-in members who lack every one of `roles`. */
export async function gateSection(roles: readonly Role[]): Promise<void> {
  const target = sectionGateRedirect(await getCurrentUser(), roles);
  if (target) redirect(target);
}

/**
 * Redirect (a real 307) signed-in members for whom `allowed` is false to
 * `target`, for sections whose pages use a permission helper and send
 * members somewhere friendlier than /forbidden (for example learners who open
 * the assignment manager go to the catalog). `target` is a fixed in-app path.
 */
export async function gateSectionWith(allowed: (user: User) => boolean, target: `/${string}`): Promise<void> {
  const user = await getCurrentUser();
  if (user && !allowed(user)) redirect(target);
}
