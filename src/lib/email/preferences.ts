/**
 * Email preference categories (per learner) and the mapping from in-app
 * notification types to them. Pure module shared by server and client code.
 */
import type { EmailCategory, EmailPreferences, Notification, NotificationType, User } from "@/lib/types";

export type EmailPreferenceKey = keyof EmailPreferences;

export const EMAIL_PREFERENCE_OPTIONS: { key: EmailPreferenceKey; label: string; description: string }[] = [
  {
    key: "enrollment",
    label: "Enrollments",
    description: "Confirmations when you join a course, batch or program, and new enrollments in courses you teach.",
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "Announcements and messages from your instructors, and news about newly published courses and batches.",
  },
  { key: "liveClasses", label: "Live classes", description: "New and rescheduled live classes, same-day reminders and recordings." },
  { key: "grading", label: "Grades and feedback", description: "Quiz results, assignment grades and comments from instructors." },
  { key: "certificates", label: "Certificates and badges", description: "Certificates issued to you, evaluation updates and badges you earn." },
  { key: "discussions", label: "Discussions", description: "Replies to discussions you take part in and when someone mentions you." },
  { key: "reminders", label: "Reminders and updates", description: "Batch start reminders, course completion and other account updates." },
  { key: "payments", label: "Payment reminders", description: "Reminders about unpaid orders and refund updates. Receipts are always sent." },
];

export const EMAIL_PREFERENCE_KEYS: EmailPreferenceKey[] = EMAIL_PREFERENCE_OPTIONS.map((o) => o.key);

export function isEmailPreferenceKey(value: unknown): value is EmailPreferenceKey {
  return typeof value === "string" && (EMAIL_PREFERENCE_KEYS as string[]).includes(value);
}

export function preferenceLabel(key: EmailPreferenceKey | "all"): string {
  if (key === "all") return "all optional emails";
  return EMAIL_PREFERENCE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

/** Everyone starts subscribed to every category. */
export function defaultEmailPreferences(): EmailPreferences {
  return {
    enrollment: true,
    announcements: true,
    liveClasses: true,
    grading: true,
    certificates: true,
    discussions: true,
    reminders: true,
    payments: true,
  };
}

/** Stored preferences merged over the defaults (older accounts have none). */
export function resolveEmailPreferences(user: Pick<User, "emailPreferences"> | null | undefined): EmailPreferences {
  const defaults = defaultEmailPreferences();
  const stored = user?.emailPreferences;
  if (!stored) return defaults;
  const out = { ...defaults };
  for (const key of EMAIL_PREFERENCE_KEYS) if (typeof stored[key] === "boolean") out[key] = stored[key];
  return out;
}

/* ------------------------------------------------------------------ */
/* Notification types                                                  */
/* ------------------------------------------------------------------ */

export const NOTIFICATION_TYPE_OPTIONS: { value: NotificationType; label: string; description: string }[] = [
  { value: "enrollment", label: "Enrollments", description: "Learners joining courses and batches; confirmations to the learner." },
  { value: "announcement", label: "Announcements", description: "Batch and course announcements from instructors." },
  { value: "live_class", label: "Live classes", description: "Scheduled, rescheduled and same-day live classes, and recordings." },
  { value: "assignment_graded", label: "Assignment grading", description: "Assignment grades and instructor comments." },
  { value: "quiz_graded", label: "Quiz grading", description: "Manually graded quiz results." },
  { value: "certificate", label: "Certificates", description: "Certificates issued and evaluation updates." },
  { value: "badge", label: "Badges", description: "Badges earned by learners." },
  { value: "reply", label: "Discussion replies", description: "New replies in discussions a member takes part in." },
  { value: "mention", label: "Mentions", description: "When someone @mentions a member." },
  { value: "course_published", label: "New courses", description: "Course publishing notices (also see Learning → notifications)." },
  { value: "batch_published", label: "New batches", description: "Batch publishing notices (also see Learning → notifications)." },
  { value: "system", label: "Other updates", description: "Reminders, reviews, job applications and other account updates." },
];

export const NOTIFICATION_TYPES: NotificationType[] = NOTIFICATION_TYPE_OPTIONS.map((o) => o.value);

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as string[]).includes(value);
}

const TYPE_PREFERENCE: Record<NotificationType, EmailPreferenceKey> = {
  enrollment: "enrollment",
  course_published: "announcements",
  batch_published: "announcements",
  live_class: "liveClasses",
  assignment_graded: "grading",
  quiz_graded: "grading",
  certificate: "certificates",
  badge: "certificates",
  mention: "discussions",
  reply: "discussions",
  announcement: "announcements",
  system: "reminders",
};

/** Preference category that governs the email copy of a notification. */
export function preferenceForNotification(n: Pick<Notification, "type" | "link" | "dedupeKey">): EmailPreferenceKey {
  if (n.dedupeKey?.startsWith("payment") || n.link?.startsWith("/billing")) return "payments";
  if (n.dedupeKey?.startsWith("live-class")) return "liveClasses";
  return TYPE_PREFERENCE[n.type] ?? "reminders";
}

/** Outbox category recorded for the email copy of a notification. */
export function emailCategoryForNotification(n: Pick<Notification, "type" | "link" | "dedupeKey">): EmailCategory {
  if (n.dedupeKey?.startsWith("payment") || n.link?.startsWith("/billing")) return "payment";
  if (n.dedupeKey) return "reminder";
  if (n.type === "announcement") return "announcement";
  return "notification";
}

/* ------------------------------------------------------------------ */
/* Outbox categories                                                   */
/* ------------------------------------------------------------------ */

export const EMAIL_CATEGORY_LABELS: Record<EmailCategory, string> = {
  password_reset: "Password reset",
  email_verification: "Email verification",
  welcome: "Welcome",
  notification: "Notification",
  announcement: "Announcement",
  batch: "Batch",
  payment: "Payment",
  reminder: "Reminder",
  test: "Test",
  other: "Other",
};

export const EMAIL_CATEGORIES = Object.keys(EMAIL_CATEGORY_LABELS) as EmailCategory[];

export function isEmailCategory(value: unknown): value is EmailCategory {
  return typeof value === "string" && value in EMAIL_CATEGORY_LABELS;
}

/** Categories that carry one-time secrets (links with tokens) and must never be opted out of. */
export const SENSITIVE_EMAIL_CATEGORIES: EmailCategory[] = ["password_reset", "email_verification"];

/** Categories that are transactional (no unsubscribe header). */
export const TRANSACTIONAL_EMAIL_CATEGORIES: EmailCategory[] = ["password_reset", "email_verification", "welcome", "test"];
