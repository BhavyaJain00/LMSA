import "server-only";
import type { Course, Database, Settings, User } from "@/lib/types";
import { aiEnv } from "@/lib/server-env";
import { canManageCourse } from "@/lib/data/courses";
import { enrollmentGrantsAccess } from "@/lib/commerce/access";
import type { AiUnavailableReason } from "./types";

/**
 * Who may use the AI tutor, and whether it is set up at all.
 *
 * The tutor runs only when the site switch (Settings → AI tutor), the
 * ANTHROPIC_API_KEY and the course's own "AI tutor" switch are all on. It is
 * available to learners enrolled in the course and to its managers
 * (instructors, moderators, admins), who can try it before learners do. An
 * enrollment only counts while it still grants access to the course (a lapsed
 * membership or overdue installments block the tutor as they block lessons).
 */

export function aiKeyConfigured(): boolean {
  return aiEnv.anthropicApiKey.length > 0;
}

/** Masked form of a secret for display: its prefix family and last four characters only. */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  const tail = secret.length > 12 ? secret.slice(-4) : "";
  const family = /^sk-ant-[a-z]+\d*-/i.exec(secret)?.[0] ?? (secret.startsWith("sk-") ? "sk-" : "");
  return `${family}${"•".repeat(8)}${tail}`;
}

/** The configured ANTHROPIC_API_KEY, masked (empty when unset). */
export function aiKeyHint(): string {
  return maskSecret(aiEnv.anthropicApiKey);
}

export interface AiSiteStatus {
  enabled: boolean;
  keyConfigured: boolean;
  /** Both on: courses that opt in can use the tutor. */
  ready: boolean;
}

export function aiSiteStatus(settings: Pick<Settings, "ai">): AiSiteStatus {
  const keyConfigured = aiKeyConfigured();
  return { enabled: settings.ai.enabled, keyConfigured, ready: settings.ai.enabled && keyConfigured };
}

export type CourseTutorAccess = { ok: true; manager: boolean; enrolled: boolean } | { ok: false; reason: AiUnavailableReason; manager: boolean };

type AccessDb = Pick<Database, "settings" | "enrollments" | "courses" | "payments" | "subscriptions" | "plans" | "batches" | "batchEnrollments" | "bundles">;

/** Resolve access for one viewer and course from a database snapshot. */
export function courseTutorAccess(db: AccessDb, course: Course, user: Pick<User, "id" | "roles"> | null, now: number = Date.now()): CourseTutorAccess {
  const manager = canManageCourse(user, course);
  const site = aiSiteStatus(db.settings);
  if (!site.enabled) return { ok: false, reason: "site_disabled", manager };
  if (!site.keyConfigured) return { ok: false, reason: "no_key", manager };
  if (!course.aiTutorEnabled) return { ok: false, reason: "course_disabled", manager };
  if (!user) return { ok: false, reason: "signin", manager };
  if (!course.published && !manager) return { ok: false, reason: "not_found", manager };
  const enrollment = db.enrollments.find((e) => e.userId === user.id && e.courseId === course.id);
  const enrolled = !!enrollment && enrollmentGrantsAccess(db, enrollment, now);
  if (!enrolled && !manager) return { ok: false, reason: enrollment ? "access_ended" : "not_enrolled", manager };
  return { ok: true, manager, enrolled };
}

/** Learner-facing explanation for an unavailable tutor. */
export function unavailableMessage(reason: AiUnavailableReason): string {
  switch (reason) {
    case "signin":
      return "Sign in to ask the AI tutor.";
    case "not_enrolled":
      return "Enroll in this course to ask the AI tutor about it.";
    case "access_ended":
      return "Your access to this course has ended. Renew it to ask the AI tutor again.";
    case "course_disabled":
      return "The AI tutor is not turned on for this course.";
    case "not_found":
      return "This course is not available.";
    default:
      return "The AI tutor is not available right now.";
  }
}
