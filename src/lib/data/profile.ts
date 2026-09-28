import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { PublicUser, Role, User } from "@/lib/types";
import { getDb } from "@/lib/db/store";
import { getCurrentUser, hasRole, isEvaluator, isModerator, toPublicUser } from "@/lib/auth/session";
import { getUserByUsername } from "@/lib/data/users";
import { toCourseCard, type CourseCardData } from "@/lib/data/dashboard";

export interface ProfileStats {
  enrolled: number;
  completed: number;
  lessonsCompleted: number;
  certificates: number;
  badges: number;
  teaching: number;
}

export interface ProfileView {
  /** Public projection; `email` is blanked and `persona` removed when the viewer may not see them. */
  user: PublicUser;
  viewer: User | null;
  isSelf: boolean;
  canEdit: boolean;
  canManageRoles: boolean;
  canSeeEmail: boolean;
  /** Slots / Schedule tabs: viewer is evaluator or moderator AND the profile user is an evaluator or moderator. */
  showEvaluatorTabs: boolean;
  stats: ProfileStats;
}

export interface ProfileBadgeGroup {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  count: number;
  /** Most recent issue date. */
  issuedOn: string;
  dates: string[];
}

export interface ProfileCertificate {
  id: string;
  code: string;
  title: string;
  kind: "course" | "batch";
  href: string;
  subjectHref: string | null;
  issueDate: string;
  expiryDate?: string;
  evaluatorName: string | null;
}

function canEdit(viewer: User | null, target: User): boolean {
  if (!viewer) return false;
  if (viewer.id === target.id) return true;
  if (!isModerator(viewer)) return false;
  return !target.roles.includes("admin") || viewer.roles.includes("admin");
}

/**
 * Resolve a profile for the current viewer. Memoized per request so the
 * layout and the tab pages share one lookup. Returns `null` when the user
 * does not exist (or is disabled and the viewer is not a moderator).
 */
export const getProfileView = cache(async (username: string): Promise<ProfileView | null> => {
  const [viewer, target] = await Promise.all([getCurrentUser(), getUserByUsername(username)]);
  if (!target) return null;
  if (!target.enabled && !isModerator(viewer)) return null;

  const db = await getDb();
  const isSelf = viewer?.id === target.id;
  const moderator = isModerator(viewer);
  const canSeeEmail = isSelf || moderator;

  const pub = toPublicUser(target);
  const user: PublicUser = { ...pub, email: canSeeEmail ? pub.email : "" };
  if (!isSelf && !moderator) delete user.persona;

  const enrollments = db.enrollments.filter((e) => e.userId === target.id && e.memberType === "student");
  const stats: ProfileStats = {
    enrolled: enrollments.length,
    completed: enrollments.filter((e) => e.completedAt || e.progress >= 100).length,
    lessonsCompleted: db.progress.filter((p) => p.userId === target.id && p.status === "complete").length,
    certificates: db.certificates.filter((c) => c.userId === target.id && c.published).length,
    badges: db.badgeAssignments.filter((a) => a.userId === target.id).length,
    teaching: db.courses.filter((c) => c.published && c.instructorIds.includes(target.id)).length,
  };

  return {
    user,
    viewer,
    isSelf,
    canEdit: canEdit(viewer, target),
    canManageRoles: moderator,
    canSeeEmail,
    showEvaluatorTabs: !!viewer && isEvaluator(viewer) && hasRole(target, "batch_evaluator", "moderator"),
    stats,
  };
});

/** Badges earned by a user, grouped by badge with a count (a badge can be earned more than once). */
export async function getProfileBadges(userId: string): Promise<ProfileBadgeGroup[]> {
  const db = await getDb();
  const groups = new Map<string, ProfileBadgeGroup>();
  for (const a of db.badgeAssignments.filter((x) => x.userId === userId)) {
    const badge = db.badges.find((b) => b.id === a.badgeId);
    if (!badge) continue;
    const group = groups.get(badge.id);
    if (group) {
      group.count++;
      group.dates.push(a.issuedOn);
      if (a.issuedOn > group.issuedOn) group.issuedOn = a.issuedOn;
    } else {
      groups.set(badge.id, {
        id: badge.id,
        title: badge.title,
        description: badge.description,
        imageUrl: badge.imageUrl,
        count: 1,
        issuedOn: a.issuedOn,
        dates: [a.issuedOn],
      });
    }
  }
  return Array.from(groups.values())
    .map((g) => ({ ...g, dates: g.dates.sort().reverse() }))
    .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn));
}

/** Published certificates of a user (newest first). */
export async function getProfileCertificates(userId: string): Promise<ProfileCertificate[]> {
  const db = await getDb();
  return db.certificates
    .filter((c) => c.userId === userId && c.published)
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate))
    .map((c) => {
      const course = c.courseId ? db.courses.find((x) => x.id === c.courseId) : undefined;
      const batch = c.batchId ? db.batches.find((x) => x.id === c.batchId) : undefined;
      const evaluator = c.evaluatorId ? db.users.find((u) => u.id === c.evaluatorId) : undefined;
      return {
        id: c.id,
        code: c.code,
        title: course?.title ?? batch?.title ?? "Certificate",
        kind: course ? ("course" as const) : ("batch" as const),
        href: `/certificates/${c.code}`,
        subjectHref: course ? `/courses/${course.slug}` : batch ? `/batches/${batch.slug}` : null,
        issueDate: c.issueDate,
        expiryDate: c.expiryDate,
        evaluatorName: evaluator?.name ?? null,
      };
    });
}

/** Published courses a user teaches (for instructor profiles). */
export async function getTeachingCourses(userId: string, limit = 6): Promise<CourseCardData[]> {
  const db = await getDb();
  return db.courses
    .filter((c) => c.published && c.instructorIds.includes(userId))
    .sort((a, b) => Number(b.featured) - Number(a.featured) || (b.publishedOn ?? b.createdAt).localeCompare(a.publishedOn ?? a.createdAt))
    .slice(0, limit)
    .map((c) => toCourseCard(db, c));
}

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
}

/** How complete a profile is (drives the "Complete your profile" card). */
export function profileCompleteness(user: Pick<PublicUser, "avatarUrl" | "headline" | "bio" | "location" | "skills" | "socials" | "education" | "workExperience">): {
  percent: number;
  items: CompletenessItem[];
} {
  const items: CompletenessItem[] = [
    { key: "avatar", label: "Add a profile photo", done: !!user.avatarUrl },
    { key: "headline", label: "Write a headline", done: !!user.headline },
    { key: "bio", label: "Tell people about yourself", done: !!user.bio },
    { key: "location", label: "Add your location", done: !!user.location },
    { key: "skills", label: "List a few skills", done: !!user.skills?.length },
    { key: "socials", label: "Link a social profile", done: !!user.socials && Object.values(user.socials).some(Boolean) },
    { key: "experience", label: "Add education or work experience", done: !!user.education?.length || !!user.workExperience?.length },
  ];
  const done = items.filter((i) => i.done).length;
  return { percent: Math.round((done / items.length) * 100), items };
}

/** Roles shown on the Roles tab, in display order. */
export const MANAGEABLE_ROLES: { role: Role; label: string; description: string }[] = [
  { role: "student", label: "Student", description: "Learn courses and track progress" },
  { role: "course_creator", label: "Course Creator", description: "Build and manage courses, chapters, and lessons" },
  { role: "batch_evaluator", label: "Evaluator", description: "Manage batches, review and grade submissions" },
  { role: "moderator", label: "Moderator", description: "Oversee all users, content, and system settings" },
  { role: "admin", label: "Admin", description: "Full access, including site settings and payments" },
];

/** Absolute origin of the current request (used for share links). */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto.split(",")[0]!.trim()}://${host.split(",")[0]!.trim()}`;
}
