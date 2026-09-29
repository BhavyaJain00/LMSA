import "server-only";
import type { Batch, Course, Database, EmailTemplate, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { addMinutesToClock, formatClock12, formatDayKey } from "@/components/batches/tz";
import { brandFromSettings } from "./context";
import { escapeMarkdown } from "./markdown";
import { isSafeAddress } from "./mime";
import { type EnqueueEmailInput, enqueueEmails } from "./outbox";
import { resolveEmailPreferences, type EmailPreferenceKey } from "./preferences";
import { preferencesUrl, unsubscribeUrl } from "./signing";
import { type EmailBrand, type EmailFooter, announcementEmail, batchMessageEmail, enrollmentConfirmationEmail, type RenderedEmail } from "./templates";

/**
 * Batch and course emails: announcements, messages written from batch email
 * templates, and the batch enrollment confirmation. Placeholders such as
 * `{{ member_name }}` are filled per recipient; values are markdown-escaped
 * so a member's name can never inject links or formatting.
 */

export const BATCH_PLACEHOLDERS = [
  "member_name",
  "member_email",
  "batch_title",
  "batch_url",
  "start_date",
  "end_date",
  "start_time",
  "end_time",
  "timezone",
  "medium",
  "instructors",
  "site_name",
] as const;

export const COURSE_PLACEHOLDERS = ["member_name", "member_email", "course_title", "course_url", "instructors", "site_name"] as const;

/** Neutral stand-ins used where there is no single recipient (in-app copy, CC copy). */
const AUDIENCE_VALUES: Record<string, string> = { member_name: "learner", member_email: "" };

export interface BulkEmailResult {
  /** Emails queued for members. */
  queued: number;
  /** Members skipped (opted out, disabled account or invalid address). */
  skipped: number;
  /** 1 when a copy was queued for the CC addresses. */
  ccQueued: number;
  /** Email is turned off in settings (nothing was queued). */
  disabled?: boolean;
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Replace `{{ key }}` placeholders; unknown keys are left as written. */
export function fillPlaceholders(text: string, values: Record<string, string>, escape: (value: string) => string = (v) => v): string {
  return text.replace(PLACEHOLDER_RE, (match, key: string) => (key in values ? escape(values[key]!) : match));
}

function instructorNames(db: Database, ids: string[]): string {
  const names = ids.map((id) => db.users.find((u) => u.id === id)?.name).filter((n): n is string => !!n);
  return names.join(", ") || "The instructors";
}

export function batchPlaceholderValues(db: Database, batch: Batch, member?: Pick<User, "name" | "email"> | null): Record<string, string> {
  return {
    member_name: member?.name ?? AUDIENCE_VALUES.member_name!,
    member_email: member?.email ?? AUDIENCE_VALUES.member_email!,
    batch_title: batch.title,
    batch_url: `${siteConfig.appUrl}/batches/${batch.slug}`,
    start_date: formatDayKey(batch.startDate, "long"),
    end_date: formatDayKey(batch.endDate, "long"),
    start_time: formatClock12(batch.startTime),
    end_time: formatClock12(batch.endTime),
    timezone: batch.timezone,
    medium: batch.medium === "online" ? "Online" : "Offline",
    instructors: instructorNames(db, batch.instructorIds),
    site_name: db.settings.brand.name,
  };
}

export function coursePlaceholderValues(db: Database, course: Course, member?: Pick<User, "name" | "email"> | null): Record<string, string> {
  return {
    member_name: member?.name ?? AUDIENCE_VALUES.member_name!,
    member_email: member?.email ?? AUDIENCE_VALUES.member_email!,
    course_title: course.title,
    course_url: `${siteConfig.appUrl}/courses/${course.slug}`,
    instructors: instructorNames(db, course.instructorIds),
    site_name: db.settings.brand.name,
  };
}

/** Fill placeholders for an audience-wide copy (e.g. the in-app notification). */
export function batchAudienceText(db: Database, batch: Batch, text: string): string {
  return fillPlaceholders(text, batchPlaceholderValues(db, batch, null));
}

export function courseAudienceText(db: Database, course: Course, text: string): string {
  return fillPlaceholders(text, coursePlaceholderValues(db, course, null));
}

function footerFor(brand: EmailBrand, user: User, pref: EmailPreferenceKey, reason: string): EmailFooter {
  return {
    reason,
    preferencesUrl: preferencesUrl(),
    unsubscribeUrl: unsubscribeUrl(user.id, pref),
    unsubscribeLabel: pref === "announcements" ? "Unsubscribe from announcements" : "Unsubscribe from these emails",
  };
}

function emailEnabled(settings: Settings): boolean {
  return settings.email.enabled && settings.email.notifyTypes.includes("announcement");
}

function toInput(rendered: RenderedEmail, user: User, category: EnqueueEmailInput["category"]): EnqueueEmailInput {
  return { to: user.email, toName: user.name, userId: user.id, subject: rendered.subject, html: rendered.html, text: rendered.text, category };
}

/** CC addresses minus the ones that already get their own copy. */
function ccList(cc: string[] | undefined, memberEmails: Set<string>): string[] {
  return Array.from(new Set((cc ?? []).map((a) => a.trim().toLowerCase()))).filter((a) => isSafeAddress(a) && !memberEmails.has(a));
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

/** Email a batch announcement to every enrolled student (plus one copy to the CC list). */
export async function sendBatchAnnouncementEmails(announcementId: string): Promise<BulkEmailResult> {
  const db = await getDb();
  const settings = db.settings;
  const announcement = db.announcements.find((a) => a.id === announcementId);
  const batch = announcement?.batchId ? db.batches.find((b) => b.id === announcement.batchId) : null;
  if (!announcement || !batch) return { queued: 0, skipped: 0, ccQueued: 0 };
  if (!emailEnabled(settings)) return { queued: 0, skipped: 0, ccQueued: 0, disabled: true };
  const brand = brandFromSettings(settings);
  const author = db.users.find((u) => u.id === announcement.authorId);
  const studentIds = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  const url = `/batches/${batch.slug}?tab=announcements`;
  const inputs: EnqueueEmailInput[] = [];
  const memberEmails = new Set<string>();
  let skipped = 0;
  for (const id of studentIds) {
    const user = db.users.find((u) => u.id === id);
    if (!user || id === announcement.authorId) continue;
    memberEmails.add(user.email.toLowerCase());
    if (!user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).announcements) {
      skipped++;
      continue;
    }
    const values = batchPlaceholderValues(db, batch, user);
    const rendered = announcementEmail(brand, {
      recipientName: user.name,
      contextKind: "batch",
      contextTitle: batch.title,
      subject: fillPlaceholders(announcement.subject, values),
      markdown: fillPlaceholders(announcement.body, values, escapeMarkdown),
      authorName: author?.name,
      url,
      footer: footerFor(brand, user, "announcements", `You're receiving this because you're enrolled in ${batch.title}.`),
    });
    inputs.push(toInput(rendered, user, "announcement"));
  }
  const cc = ccList(announcement.cc, memberEmails);
  let ccQueued = 0;
  if (cc.length) {
    const values = batchPlaceholderValues(db, batch, null);
    const rendered = announcementEmail(brand, {
      contextKind: "batch",
      contextTitle: batch.title,
      subject: fillPlaceholders(announcement.subject, values),
      markdown: fillPlaceholders(announcement.body, values, escapeMarkdown),
      authorName: author?.name,
      url: `/batches/${batch.slug}`,
      ccRecipientCount: inputs.length,
      footer: { reason: `You were copied on this announcement by ${author?.name ?? "an instructor"} of ${brand.name}.` },
    });
    inputs.push({ to: cc[0]!, cc: cc.slice(1), subject: rendered.subject, html: rendered.html, text: rendered.text, category: "announcement" });
    ccQueued = 1;
  }
  await enqueueEmails(inputs);
  return { queued: inputs.length - ccQueued, skipped, ccQueued };
}

/** Email a course announcement to enrolled learners (plus one copy to the CC list). */
export async function sendCourseAnnouncementEmails(announcementId: string): Promise<BulkEmailResult> {
  const db = await getDb();
  const settings = db.settings;
  const announcement = db.announcements.find((a) => a.id === announcementId);
  const course = announcement?.courseId ? db.courses.find((c) => c.id === announcement.courseId) : null;
  if (!announcement || !course) return { queued: 0, skipped: 0, ccQueued: 0 };
  if (!emailEnabled(settings)) return { queued: 0, skipped: 0, ccQueued: 0, disabled: true };
  const brand = brandFromSettings(settings);
  const author = db.users.find((u) => u.id === announcement.authorId);
  const learnerIds = new Set(db.enrollments.filter((e) => e.courseId === course.id && e.memberType !== "staff").map((e) => e.userId));
  const inputs: EnqueueEmailInput[] = [];
  const memberEmails = new Set<string>();
  let skipped = 0;
  for (const id of learnerIds) {
    const user = db.users.find((u) => u.id === id);
    if (!user || id === announcement.authorId) continue;
    memberEmails.add(user.email.toLowerCase());
    if (!user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).announcements) {
      skipped++;
      continue;
    }
    const values = coursePlaceholderValues(db, course, user);
    const rendered = announcementEmail(brand, {
      recipientName: user.name,
      contextKind: "course",
      contextTitle: course.title,
      subject: fillPlaceholders(announcement.subject, values),
      markdown: fillPlaceholders(announcement.body, values, escapeMarkdown),
      authorName: author?.name,
      url: `/courses/${course.slug}`,
      footer: footerFor(brand, user, "announcements", `You're receiving this because you're enrolled in ${course.title}.`),
    });
    inputs.push(toInput(rendered, user, "announcement"));
  }
  const cc = ccList(announcement.cc, memberEmails);
  let ccQueued = 0;
  if (cc.length) {
    const values = coursePlaceholderValues(db, course, null);
    const rendered = announcementEmail(brand, {
      contextKind: "course",
      contextTitle: course.title,
      subject: fillPlaceholders(announcement.subject, values),
      markdown: fillPlaceholders(announcement.body, values, escapeMarkdown),
      authorName: author?.name,
      url: `/courses/${course.slug}`,
      ccRecipientCount: inputs.length,
      footer: { reason: `You were copied on this announcement by ${author?.name ?? "an instructor"} of ${brand.name}.` },
    });
    inputs.push({ to: cc[0]!, cc: cc.slice(1), subject: rendered.subject, html: rendered.html, text: rendered.text, category: "announcement" });
    ccQueued = 1;
  }
  await enqueueEmails(inputs);
  return { queued: inputs.length - ccQueued, skipped, ccQueued };
}

/* ------------------------------------------------------------------ */
/* Batch messages (email templates / compose)                          */
/* ------------------------------------------------------------------ */

export interface BatchMessageInput {
  batchId: string;
  subject: string;
  /** Markdown with placeholders. */
  body: string;
  /** Limit to these enrolled students (default: every enrolled student). */
  userIds?: string[];
  cc?: string[];
  senderId: string;
}

export type BatchMessageResult = ({ ok: true } & BulkEmailResult) | { ok: false; error: string };

/** Send a message (from a batch email template or composed ad hoc) to a batch's students. */
export async function sendBatchMessage(input: BatchMessageInput): Promise<BatchMessageResult> {
  const db = await getDb();
  const settings = db.settings;
  if (!settings.email.enabled) return { ok: false, error: "Email is turned off. Enable it in Settings → Email first." };
  const batch = db.batches.find((b) => b.id === input.batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  const brand = brandFromSettings(settings);
  const sender = db.users.find((u) => u.id === input.senderId);
  const enrolled = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  const targets = input.userIds?.length ? input.userIds.filter((id) => enrolled.has(id)) : Array.from(enrolled);
  if (!targets.length && !input.cc?.length) return { ok: false, error: "There is nobody to send this message to." };

  const inputs: EnqueueEmailInput[] = [];
  const memberEmails = new Set<string>();
  let skipped = 0;
  for (const id of new Set(targets)) {
    const user = db.users.find((u) => u.id === id);
    if (!user) continue;
    memberEmails.add(user.email.toLowerCase());
    if (!user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).announcements) {
      skipped++;
      continue;
    }
    const values = batchPlaceholderValues(db, batch, user);
    const rendered = batchMessageEmail(brand, {
      subject: fillPlaceholders(input.subject, values),
      markdown: fillPlaceholders(input.body, values, escapeMarkdown),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      senderName: sender?.name,
      footer: footerFor(brand, user, "announcements", `You're receiving this because you're enrolled in ${batch.title}.`),
    });
    inputs.push(toInput(rendered, user, "batch"));
  }
  const cc = ccList(input.cc, memberEmails);
  let ccQueued = 0;
  if (cc.length) {
    const values = batchPlaceholderValues(db, batch, null);
    const rendered = batchMessageEmail(brand, {
      subject: fillPlaceholders(input.subject, values),
      markdown: fillPlaceholders(input.body, values, escapeMarkdown),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      senderName: sender?.name,
      ccRecipientCount: inputs.length,
      footer: { reason: `You were copied on this message by ${sender?.name ?? "a staff member"} of ${brand.name}.` },
    });
    inputs.push({ to: cc[0]!, cc: cc.slice(1), subject: rendered.subject, html: rendered.html, text: rendered.text, category: "batch" });
    ccQueued = 1;
  }
  if (!inputs.length) return { ok: false, error: skipped ? "Every selected student has turned off these emails or has no valid address." : "There is nobody to send this message to." };
  await enqueueEmails(inputs);
  return { ok: true, queued: inputs.length - ccQueued, skipped, ccQueued };
}

/* ------------------------------------------------------------------ */
/* Batch enrollment confirmation                                       */
/* ------------------------------------------------------------------ */

/** The batch's own confirmation template (Frappe: batch confirmation email template), if any. */
export function findConfirmationTemplate(db: Database, batchId: string): EmailTemplate | null {
  const templates = db.emailTemplates.filter((t) => t.batchId === batchId);
  return templates.find((t) => /confirm/i.test(t.name)) ?? templates.find((t) => /enrol/i.test(t.name)) ?? null;
}

/** Render the confirmation for one member: the batch template when present, the built-in one otherwise. */
export function renderBatchConfirmation(db: Database, brand: EmailBrand, batch: Batch, user: User): RenderedEmail {
  const footer = footerFor(brand, user, "enrollment", `You're receiving this because you enrolled in ${batch.title}.`);
  const template = findConfirmationTemplate(db, batch.id);
  if (template) {
    const values = batchPlaceholderValues(db, batch, user);
    return batchMessageEmail(brand, {
      subject: fillPlaceholders(template.subject, values),
      markdown: fillPlaceholders(template.body, values, escapeMarkdown),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      footer,
    });
  }
  const liveClasses = db.liveClasses.filter((c) => c.batchId === batch.id).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const next = liveClasses.find((c) => c.date >= new Date().toISOString().slice(0, 10));
  return enrollmentConfirmationEmail(brand, {
    name: user.name,
    kind: "batch",
    title: batch.title,
    url: `/batches/${batch.slug}`,
    summary: batch.description || undefined,
    details: [
      { label: "Dates", value: batch.startDate === batch.endDate ? formatDayKey(batch.startDate, "long") : `${formatDayKey(batch.startDate, "long")} – ${formatDayKey(batch.endDate, "long")}` },
      { label: "Sessions", value: batch.startTime ? `${formatClock12(batch.startTime)} – ${formatClock12(batch.endTime)}` : "" },
      { label: "Timezone", value: batch.timezone },
      { label: "Format", value: batch.medium === "online" ? "Online" : "In person" },
      { label: "Instructors", value: instructorNames(db, batch.instructorIds) },
      { label: "Courses", value: String(batch.courseIds.length || "") },
      {
        label: "Next live class",
        value: next ? `${next.title} · ${formatDayKey(next.date, "long")}, ${formatClock12(next.time)} – ${formatClock12(addMinutesToClock(next.time, next.durationMinutes))}` : "",
      },
    ],
    footer,
  });
}

/**
 * Send the enrollment confirmation for a batch once per member
 * (`BatchEnrollment.confirmationEmailSent`). Respects the member's
 * "enrollment" preference and the email master switch.
 */
export async function sendBatchConfirmationEmail(batchId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  if (!db.settings.email.enabled) return false;
  const batch = db.batches.find((b) => b.id === batchId);
  const user = db.users.find((u) => u.id === userId);
  const enrollment = db.batchEnrollments.find((e) => e.batchId === batchId && e.userId === userId);
  if (!batch || !user || !enrollment || enrollment.confirmationEmailSent) return false;
  if (!user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).enrollment) return false;
  const claimed = await mutate((d) => {
    const row = d.batchEnrollments.find((e) => e.id === enrollment.id);
    if (!row || row.confirmationEmailSent) return false;
    row.confirmationEmailSent = true;
    return true;
  });
  if (!claimed) return false;
  const rendered = renderBatchConfirmation(db, brandFromSettings(db.settings), batch, user);
  await enqueueEmails([toInput(rendered, user, "batch")]);
  return true;
}
