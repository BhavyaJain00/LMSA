import "server-only";
import type { Announcement, Batch, Course, Database, EmailTemplate, LiveClass, Settings, User } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { siteConfig } from "@/lib/config";
import { addMinutesToClock, formatClock12, formatDayKey, zonedTimeToUtc } from "@/components/batches/tz";
import { runAfterResponse } from "./background";
import { brandFromSettings } from "./context";
import { isSafeAddress } from "./mime";
import { type EnqueueEmailInput, enqueueEmails } from "./outbox";
import { fillPlaceholders, personalize, prepareMarkdown, type PreparedMarkdown } from "./personalize";
import { resolveEmailPreferences, type EmailPreferenceKey } from "./preferences";
import { externalRecipientLimitMessage, reserveCcOnlySend, reserveExternalRecipients } from "./quota";
import { preferencesUrl, unsubscribeUrl } from "./signing";
import { type EmailBrand, type EmailFooter, announcementEmail, batchMessageEmail, enrollmentConfirmationEmail, type RenderedEmail } from "./templates";

/**
 * Batch and course emails: announcements, messages written from batch email
 * templates, and the batch enrollment confirmation.
 *
 * The markdown body is rendered once per send (`prepareMarkdown`) and then
 * personalised per recipient (`personalize`): member values are inserted
 * after parsing and HTML-escaped, so a member's name can never inject links
 * or formatting, and a long body costs one render instead of one per student.
 * Bulk sends are planned synchronously (recipient counts, errors) and
 * rendered + queued after the response (`runAfterResponse`); the outbox
 * delivers them.
 */

export { fillPlaceholders };

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
  /** Emails queued (or planned) for members. */
  queued: number;
  /** Members skipped (opted out, disabled account or invalid address). */
  skipped: number;
  /** 1 when a copy was queued (or planned) for the CC addresses. */
  ccQueued: number;
  /** The CC copy was not sent because no member receives this email and CC-only sends are not allowed. */
  ccSkipped?: boolean;
  /** Email is turned off in settings (nothing was queued). */
  disabled?: boolean;
}

function instructorNames(db: Database, ids: string[]): string {
  const names = ids.map((id) => db.users.find((u) => u.id === id)?.name).filter((n): n is string => !!n);
  return names.join(", ") || "The instructors";
}

function memberValues(member?: Pick<User, "name" | "email"> | null): Record<string, string> {
  return { member_name: member?.name ?? AUDIENCE_VALUES.member_name!, member_email: member?.email ?? AUDIENCE_VALUES.member_email! };
}

export function batchPlaceholderValues(db: Database, batch: Batch, member?: Pick<User, "name" | "email"> | null): Record<string, string> {
  return {
    ...memberValues(member),
    batch_title: batch.title,
    batch_url: `${siteConfig.appUrl}/batches/${encodeURIComponent(batch.slug)}`,
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
    ...memberValues(member),
    course_title: course.title,
    course_url: `${siteConfig.appUrl}/courses/${encodeURIComponent(course.slug)}`,
    instructors: instructorNames(db, course.instructorIds),
    site_name: db.settings.brand.name,
  };
}

/** Batch placeholder values without the member-specific ones (for client previews). */
export function batchAudienceValues(db: Database, batch: Batch): Record<string, string> {
  const { member_name: _name, member_email: _email, ...rest } = batchPlaceholderValues(db, batch, null);
  void _name;
  void _email;
  return rest;
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

function prepareBody(markdown: string, audience: Record<string, string>, brand: EmailBrand): PreparedMarkdown {
  return prepareMarkdown(markdown, { values: audience, baseUrl: brand.appUrl, accentColor: brand.accentColor });
}

/** Who receives a bulk email: members who get their own copy, members skipped, and the CC list. */
interface AudiencePlan {
  members: User[];
  skipped: number;
  cc: string[];
}

function planAudience(db: Database, userIds: Iterable<string>, excludeId: string | null, cc: string[] | undefined): AudiencePlan {
  const members: User[] = [];
  const memberEmails = new Set<string>();
  let skipped = 0;
  for (const id of new Set(userIds)) {
    const user = db.users.find((u) => u.id === id);
    if (!user || id === excludeId) continue;
    memberEmails.add(user.email.toLowerCase());
    if (!user.enabled || !isSafeAddress(user.email) || !resolveEmailPreferences(user).announcements) {
      skipped++;
      continue;
    }
    members.push(user);
  }
  return { members, skipped, cc: ccList(cc, memberEmails) };
}

/* ------------------------------------------------------------------ */
/* Announcements                                                       */
/* ------------------------------------------------------------------ */

export interface AnnouncementEmailOptions {
  /**
   * Send the CC copy even when no member receives the email (a CC-only
   * send). Callers allow it for moderators within the CC-only quota.
   */
  ccOnlyAllowed?: boolean;
}

function batchAnnouncementPlan(db: Database, announcement: Announcement, batch: Batch): AudiencePlan {
  const studentIds = db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId);
  return planAudience(db, studentIds, announcement.authorId, announcement.cc);
}

function courseAnnouncementPlan(db: Database, announcement: Announcement, course: Course): AudiencePlan {
  const learnerIds = db.enrollments.filter((e) => e.courseId === course.id && e.memberType !== "staff").map((e) => e.userId);
  return planAudience(db, learnerIds, announcement.authorId, announcement.cc);
}

interface AnnouncementContext {
  kind: "batch" | "course";
  title: string;
  /** Link in the member copies. */
  url: string;
  /** Link in the CC copy. */
  ccUrl: string;
  audience: Record<string, string>;
}

async function sendAnnouncement(
  db: Database,
  announcement: Announcement,
  ctx: AnnouncementContext,
  plan: AudiencePlan,
  opts: AnnouncementEmailOptions,
): Promise<BulkEmailResult> {
  const brand = brandFromSettings(db.settings);
  const author = db.users.find((u) => u.id === announcement.authorId);
  const body = prepareBody(announcement.body, ctx.audience, brand);
  const inputs: EnqueueEmailInput[] = [];
  for (const user of plan.members) {
    const values = { ...ctx.audience, ...memberValues(user) };
    const rendered = announcementEmail(brand, {
      recipientName: user.name,
      contextKind: ctx.kind,
      contextTitle: ctx.title,
      subject: fillPlaceholders(announcement.subject, values),
      body: personalize(body, values),
      authorName: author?.name,
      url: ctx.url,
      footer: footerFor(brand, user, "announcements", `You're receiving this because you're enrolled in ${ctx.title}.`),
    });
    inputs.push(toInput(rendered, user, "announcement"));
  }
  let ccQueued = 0;
  const ccSkipped = plan.cc.length > 0 && !inputs.length && !opts.ccOnlyAllowed;
  if (plan.cc.length && !ccSkipped) {
    const rendered = announcementEmail(brand, {
      contextKind: ctx.kind,
      contextTitle: ctx.title,
      subject: fillPlaceholders(announcement.subject, ctx.audience),
      body: personalize(body, ctx.audience),
      authorName: author?.name,
      url: ctx.ccUrl,
      ccRecipientCount: inputs.length,
      footer: { reason: `You were copied on this announcement by ${author?.name ?? "an instructor"} of ${brand.name}.` },
    });
    inputs.push({ to: plan.cc[0]!, cc: plan.cc.slice(1), subject: rendered.subject, html: rendered.html, text: rendered.text, category: "announcement" });
    ccQueued = 1;
  }
  await enqueueEmails(inputs);
  return { queued: inputs.length - ccQueued, skipped: plan.skipped, ccQueued, ccSkipped: ccSkipped || undefined };
}

function batchContext(db: Database, batch: Batch): AnnouncementContext {
  return {
    kind: "batch",
    title: batch.title,
    url: `/batches/${batch.slug}?tab=announcements`,
    ccUrl: `/batches/${batch.slug}`,
    audience: batchPlaceholderValues(db, batch, null),
  };
}

function courseContext(db: Database, course: Course): AnnouncementContext {
  return { kind: "course", title: course.title, url: `/courses/${course.slug}`, ccUrl: `/courses/${course.slug}`, audience: coursePlaceholderValues(db, course, null) };
}

/** Email a batch announcement to every enrolled student (plus one copy to the CC list). Renders and queues now. */
export async function sendBatchAnnouncementEmails(announcementId: string, opts: AnnouncementEmailOptions = {}): Promise<BulkEmailResult> {
  const db = await getDb();
  const announcement = db.announcements.find((a) => a.id === announcementId);
  const batch = announcement?.batchId ? db.batches.find((b) => b.id === announcement.batchId) : null;
  if (!announcement || !batch) return { queued: 0, skipped: 0, ccQueued: 0 };
  if (!emailEnabled(db.settings)) return { queued: 0, skipped: 0, ccQueued: 0, disabled: true };
  return sendAnnouncement(db, announcement, batchContext(db, batch), batchAnnouncementPlan(db, announcement, batch), opts);
}

/** Email a course announcement to enrolled learners (plus one copy to the CC list). Renders and queues now. */
export async function sendCourseAnnouncementEmails(announcementId: string, opts: AnnouncementEmailOptions = {}): Promise<BulkEmailResult> {
  const db = await getDb();
  const announcement = db.announcements.find((a) => a.id === announcementId);
  const course = announcement?.courseId ? db.courses.find((c) => c.id === announcement.courseId) : null;
  if (!announcement || !course) return { queued: 0, skipped: 0, ccQueued: 0 };
  if (!emailEnabled(db.settings)) return { queued: 0, skipped: 0, ccQueued: 0, disabled: true };
  return sendAnnouncement(db, announcement, courseContext(db, course), courseAnnouncementPlan(db, announcement, course), opts);
}

export interface QueueAnnouncementOptions {
  /** The author may send CC-only copies (moderators); still limited by the CC-only quota. */
  allowCcOnly?: boolean;
}

/**
 * Plan an announcement's emails now (counts for the author) and render +
 * queue them after the response. A CC-only send (nobody enrolled would get
 * the email) needs `allowCcOnly` and a free slot in the author's CC-only
 * quota; otherwise the CC copy is skipped.
 */
async function queueAnnouncement(announcementId: string, kind: "batch" | "course", opts: QueueAnnouncementOptions): Promise<BulkEmailResult> {
  const db = await getDb();
  const announcement = db.announcements.find((a) => a.id === announcementId);
  if (!announcement) return { queued: 0, skipped: 0, ccQueued: 0 };
  if (!emailEnabled(db.settings)) return { queued: 0, skipped: 0, ccQueued: 0, disabled: true };
  let plan: AudiencePlan;
  if (kind === "batch") {
    const batch = announcement.batchId ? db.batches.find((b) => b.id === announcement.batchId) : null;
    if (!batch) return { queued: 0, skipped: 0, ccQueued: 0 };
    plan = batchAnnouncementPlan(db, announcement, batch);
  } else {
    const course = announcement.courseId ? db.courses.find((c) => c.id === announcement.courseId) : null;
    if (!course) return { queued: 0, skipped: 0, ccQueued: 0 };
    plan = courseAnnouncementPlan(db, announcement, course);
  }
  let ccOnlyAllowed = false;
  if (!plan.members.length && plan.cc.length && opts.allowCcOnly) ccOnlyAllowed = reserveCcOnlySend(announcement.authorId).ok;
  const ccSkipped = plan.cc.length > 0 && !plan.members.length && !ccOnlyAllowed;
  const send = kind === "batch" ? sendBatchAnnouncementEmails : sendCourseAnnouncementEmails;
  if (plan.members.length || (plan.cc.length && !ccSkipped)) {
    runAfterResponse(`${kind} announcement ${announcementId}`, () => send(announcementId, { ccOnlyAllowed }));
  }
  return { queued: plan.members.length, skipped: plan.skipped, ccQueued: plan.cc.length && !ccSkipped ? 1 : 0, ccSkipped: ccSkipped || undefined };
}

export function queueBatchAnnouncementEmails(announcementId: string, opts: QueueAnnouncementOptions = {}): Promise<BulkEmailResult> {
  return queueAnnouncement(announcementId, "batch", opts);
}

export function queueCourseAnnouncementEmails(announcementId: string, opts: QueueAnnouncementOptions = {}): Promise<BulkEmailResult> {
  return queueAnnouncement(announcementId, "course", opts);
}

/* ------------------------------------------------------------------ */
/* Batch messages (email templates / compose)                          */
/* ------------------------------------------------------------------ */

export interface BatchMessageInput {
  batchId: string;
  subject: string;
  /** Markdown with placeholders. */
  body: string;
  /**
   * Who receives the message: every enrolled student, or exactly the
   * students in `userIds`. An empty selection is refused — it never means
   * "everyone".
   */
  audience: "all" | "selected";
  userIds?: string[];
  cc?: string[];
  senderId: string;
}

export type BatchMessageResult = ({ ok: true } & BulkEmailResult) | { ok: false; error: string; field?: "recipients" | "cc" };

interface BatchMessagePlan {
  batch: Batch;
  plan: AudiencePlan;
}

function planBatchMessage(db: Database, input: BatchMessageInput): { ok: true; value: BatchMessagePlan } | { ok: false; error: string; field?: "recipients" | "cc" } {
  if (!db.settings.email.enabled) return { ok: false, error: "Email is turned off. Enable it in Settings → Email first." };
  const batch = db.batches.find((b) => b.id === input.batchId);
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  const enrolled = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  let targets: string[];
  if (input.audience === "all") {
    targets = Array.from(enrolled);
    if (!targets.length) return { ok: false, error: "No students are enrolled in this batch yet, so there is nobody to email.", field: "recipients" };
  } else if (input.audience === "selected") {
    targets = (input.userIds ?? []).filter((id) => enrolled.has(id));
    if (!targets.length) return { ok: false, error: "Choose at least one student to email.", field: "recipients" };
  } else {
    return { ok: false, error: "Choose who receives this email.", field: "recipients" };
  }
  // Batch messages always need a real recipient: CC addresses alone never make a send.
  const plan = planAudience(db, targets, null, input.cc);
  if (!plan.members.length) {
    return { ok: false, error: "Nobody would receive this email: every selected student has turned off these emails or has no valid address.", field: "recipients" };
  }
  return { ok: true, value: { batch, plan } };
}

async function deliverBatchMessage(db: Database, input: BatchMessageInput, { batch, plan }: BatchMessagePlan): Promise<BulkEmailResult> {
  const brand = brandFromSettings(db.settings);
  const sender = db.users.find((u) => u.id === input.senderId);
  const audience = batchPlaceholderValues(db, batch, null);
  const body = prepareBody(input.body, audience, brand);
  const inputs: EnqueueEmailInput[] = [];
  for (const user of plan.members) {
    const values = { ...audience, ...memberValues(user) };
    const rendered = batchMessageEmail(brand, {
      subject: fillPlaceholders(input.subject, values),
      body: personalize(body, values),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      senderName: sender?.name,
      footer: footerFor(brand, user, "announcements", `You're receiving this because you're enrolled in ${batch.title}.`),
    });
    inputs.push(toInput(rendered, user, "batch"));
  }
  let ccQueued = 0;
  if (plan.cc.length && inputs.length) {
    const rendered = batchMessageEmail(brand, {
      subject: fillPlaceholders(input.subject, audience),
      body: personalize(body, audience),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      senderName: sender?.name,
      ccRecipientCount: inputs.length,
      footer: { reason: `You were copied on this message by ${sender?.name ?? "a staff member"} of ${brand.name}.` },
    });
    inputs.push({ to: plan.cc[0]!, cc: plan.cc.slice(1), subject: rendered.subject, html: rendered.html, text: rendered.text, category: "batch" });
    ccQueued = 1;
  }
  await enqueueEmails(inputs);
  return { queued: inputs.length - ccQueued, skipped: plan.skipped, ccQueued };
}

function reserveCc(input: BatchMessageInput, plan: AudiencePlan): BatchMessageResult | null {
  if (!plan.cc.length) return null;
  const quota = reserveExternalRecipients(input.senderId, plan.cc.length);
  return quota.ok ? null : { ok: false, error: externalRecipientLimitMessage(quota), field: "cc" };
}

/** Send a message to a batch's students now (renders and queues before resolving). */
export async function sendBatchMessage(input: BatchMessageInput): Promise<BatchMessageResult> {
  const db = await getDb();
  const planned = planBatchMessage(db, input);
  if (!planned.ok) return planned;
  const refused = reserveCc(input, planned.value.plan);
  if (refused) return refused;
  return { ok: true, ...(await deliverBatchMessage(db, input, planned.value)) };
}

/**
 * Validate and plan a batch message now (errors and counts for the sender),
 * then render and queue it after the response.
 */
export async function queueBatchMessage(input: BatchMessageInput): Promise<BatchMessageResult> {
  const db = await getDb();
  const planned = planBatchMessage(db, input);
  if (!planned.ok) return planned;
  const refused = reserveCc(input, planned.value.plan);
  if (refused) return refused;
  const { plan } = planned.value;
  runAfterResponse(`batch message for ${input.batchId}`, async () => {
    const fresh = await getDb();
    await deliverBatchMessage(fresh, input, planned.value);
  });
  return { ok: true, queued: plan.members.length, skipped: plan.skipped, ccQueued: plan.cc.length ? 1 : 0 };
}

/* ------------------------------------------------------------------ */
/* Batch enrollment confirmation                                       */
/* ------------------------------------------------------------------ */

/** The batch's own confirmation template (Frappe: batch confirmation email template), if any. */
export function findConfirmationTemplate(db: Database, batchId: string): EmailTemplate | null {
  const templates = db.emailTemplates.filter((t) => t.batchId === batchId);
  return templates.find((t) => /confirm/i.test(t.name)) ?? templates.find((t) => /enrol/i.test(t.name)) ?? null;
}

/**
 * The batch's next live class that hasn't ended yet, compared as absolute
 * instants in each class's own timezone (a class date alone is a local day).
 */
export function nextLiveClass(classes: LiveClass[], batchTimezone: string, now: number = Date.now()): LiveClass | null {
  let best: { c: LiveClass; start: number } | null = null;
  for (const c of classes) {
    const start = zonedTimeToUtc(c.date, c.time, c.timezone || batchTimezone);
    if (Number.isNaN(start)) continue;
    if (start + Math.max(0, c.durationMinutes || 0) * 60_000 <= now) continue;
    if (!best || start < best.start) best = { c, start };
  }
  return best?.c ?? null;
}

/** Render the confirmation for one member: the batch template when present, the built-in one otherwise. */
export function renderBatchConfirmation(db: Database, brand: EmailBrand, batch: Batch, user: User): RenderedEmail {
  const footer = footerFor(brand, user, "enrollment", `You're receiving this because you enrolled in ${batch.title}.`);
  const template = findConfirmationTemplate(db, batch.id);
  if (template) {
    const audience = batchPlaceholderValues(db, batch, null);
    const values = { ...audience, ...memberValues(user) };
    return batchMessageEmail(brand, {
      subject: fillPlaceholders(template.subject, values),
      body: personalize(prepareBody(template.body, audience, brand), values),
      batchTitle: batch.title,
      batchUrl: `/batches/${batch.slug}`,
      footer,
    });
  }
  const next = nextLiveClass(
    db.liveClasses.filter((c) => c.batchId === batch.id),
    batch.timezone,
  );
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
        value: next
          ? `${next.title} · ${formatDayKey(next.date, "long")}, ${formatClock12(next.time)} – ${formatClock12(addMinutesToClock(next.time, next.durationMinutes))}${next.timezone && next.timezone !== batch.timezone ? ` (${next.timezone})` : ""}`
          : "",
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
