import "server-only";
import type { Badge, BadgeEvent } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { toDateKey, uid } from "@/lib/utils";
import { notify } from "./notifications";

/**
 * Evaluate badge rules for a user after an event and grant any that apply.
 * Returns the badges granted by this call.
 */
export async function evaluateBadges(userId: string, event: BadgeEvent, value?: number): Promise<Badge[]> {
  const db = await getDb();
  const candidates = db.badges.filter((b) => b.enabled && b.event === event);
  if (!candidates.length) return [];

  const granted: Badge[] = [];
  for (const badge of candidates) {
    const already = db.badgeAssignments.some((a) => a.badgeId === badge.id && a.userId === userId);
    if (already && badge.grantOnlyOnce) continue;

    let qualifies = true;
    switch (event) {
      case "course_enrolled":
        qualifies = db.enrollments.filter((e) => e.userId === userId).length >= (badge.threshold ?? 1);
        break;
      case "course_completed":
        qualifies = db.enrollments.filter((e) => e.userId === userId && e.completedAt).length >= (badge.threshold ?? 1);
        break;
      case "quiz_passed":
        qualifies = (value ?? 0) >= (badge.threshold ?? 0);
        break;
      case "assignment_passed":
        qualifies = db.assignmentSubmissions.filter((s) => s.userId === userId && s.status === "pass").length >= (badge.threshold ?? 1);
        break;
      case "certificate_issued":
        qualifies = db.certificates.some((c) => c.userId === userId);
        break;
      case "streak_7":
        qualifies = (value ?? 0) >= 7;
        break;
      case "streak_30":
        qualifies = (value ?? 0) >= 30;
        break;
      case "manual":
        qualifies = false;
        break;
    }
    if (!qualifies) continue;
    await grantBadge(userId, badge.id);
    granted.push(badge);
  }
  return granted;
}

export async function grantBadge(userId: string, badgeId: string): Promise<void> {
  const db = await getDb();
  const badge = db.badges.find((b) => b.id === badgeId);
  if (!badge) return;
  await mutate((d) => {
    d.badgeAssignments.push({ id: uid("ba"), badgeId, userId, issuedOn: toDateKey() });
  });
  const user = db.users.find((u) => u.id === userId);
  await notify(userId, {
    type: "badge",
    subject: `You earned the ${badge.title} badge`,
    message: badge.description,
    link: user ? `/user/${user.username}` : undefined,
  });
}

export async function getUserBadges(userId: string): Promise<(Badge & { issuedOn: string })[]> {
  const db = await getDb();
  const badges = new Map(db.badges.map((b) => [b.id, b]));
  return db.badgeAssignments
    .filter((a) => a.userId === userId)
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
    .map((a) => {
      const badge = badges.get(a.badgeId);
      return badge ? { ...badge, issuedOn: a.issuedOn } : null;
    })
    .filter((b): b is Badge & { issuedOn: string } => !!b);
}
