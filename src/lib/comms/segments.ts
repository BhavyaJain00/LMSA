/**
 * Audience segments for broadcasts (and anything else that emails a group).
 *
 * A `SegmentFilter` either describes members (accounts) — every condition
 * that is set must match — or, with `leadsOnly`, marketing leads that have
 * no account. On top of the filter, these rules always apply:
 *
 *  - members: the account is enabled, the address is valid, the email was
 *    verified when verification is required, and the member hasn't turned
 *    off the "Announcements" email category (which is also what
 *    "unsubscribe from all" switches off);
 *  - leads: marketing consent was given, the double opt-in was confirmed and
 *    the address hasn't unsubscribed;
 *  - every address appears once.
 *
 * Pure module (no server imports): the admin preview, the broadcast sender
 * and the tests all evaluate segments with the same code.
 */
import type { Activity, Enrollment, Lead, LessonProgress, Payment, Role, SegmentFilter, User } from "@/lib/types";
import { isValidEmail } from "@/lib/utils";

export type SegmentUser = Pick<
  User,
  "id" | "name" | "email" | "roles" | "enabled" | "emailPreferences" | "emailVerifiedAt" | "emailVerificationRequired" | "lastActiveAt" | "createdAt"
>;

/** The collections a segment reads. */
export interface SegmentSource {
  users: readonly SegmentUser[];
  enrollments: readonly Pick<Enrollment, "userId" | "courseId">[];
  payments: readonly Pick<Payment, "userId" | "status">[];
  leads: readonly Lead[];
  activities: readonly Pick<Activity, "userId" | "createdAt">[];
  progress: readonly Pick<LessonProgress, "userId" | "updatedAt">[];
}

export interface SegmentRecipient {
  kind: "member" | "lead";
  /** User id or lead id. */
  id: string;
  /** Lower-cased address. */
  email: string;
  /** Display name ("" for a lead without one). */
  name: string;
  /** First word of the name, for `{{ first_name }}` ("" when unknown). */
  firstName: string;
}

/** People who match the conditions but won't receive the email, by reason. */
export interface SegmentExclusions {
  /** Turned off announcements/marketing email, or unsubscribed (leads). */
  unsubscribed: number;
  /** Disabled accounts. */
  disabled: number;
  /** Address not confirmed yet (unverified account, or lead without the double opt-in / consent). */
  unconfirmed: number;
  /** Malformed address. */
  invalid: number;
  /** Same address already in the list. */
  duplicate: number;
}

export interface SegmentResult {
  recipients: SegmentRecipient[];
  excluded: SegmentExclusions;
}

export const SEGMENT_ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "student", label: "Students" },
  { value: "course_creator", label: "Course creators" },
  { value: "moderator", label: "Moderators" },
  { value: "batch_evaluator", label: "Evaluators" },
  { value: "admin", label: "Administrators" },
];

export const INACTIVE_DAY_PRESETS = [7, 14, 30, 60, 90, 180] as const;
export const MAX_INACTIVE_DAYS = 3650;
/** Most courses a single condition can list. */
export const MAX_SEGMENT_COURSES = 100;

const ROLES = new Set<Role>(SEGMENT_ROLE_OPTIONS.map((r) => r.value));
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function cleanIds(value: unknown, known?: ReadonlySet<string>): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string" || !ID_RE.test(v)) continue;
    if (known && !known.has(v)) continue;
    out.add(v);
    if (out.size >= MAX_SEGMENT_COURSES) break;
  }
  return out.size ? [...out] : undefined;
}

/**
 * Validate untrusted input (a form field, a query parameter, a stored row)
 * into a clean filter: unknown keys and values are dropped, course ids can be
 * limited to `knownCourseIds`, and member-only conditions are removed from a
 * leads segment.
 */
export function normalizeSegmentFilter(raw: unknown, knownCourseIds?: ReadonlySet<string>): SegmentFilter {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: SegmentFilter = {};
  const courseIds = cleanIds(input.courseIds, knownCourseIds);
  if (courseIds) out.courseIds = courseIds;
  if (input.leadsOnly === true) {
    out.leadsOnly = true;
    return out;
  }
  const notEnrolled = cleanIds(input.notEnrolledCourseIds, knownCourseIds)?.filter((id) => !out.courseIds?.includes(id));
  if (notEnrolled?.length) out.notEnrolledCourseIds = notEnrolled;
  if (Array.isArray(input.roles)) {
    const roles = [...new Set(input.roles.filter((r): r is Role => typeof r === "string" && ROLES.has(r as Role)))];
    if (roles.length) out.roles = roles;
  }
  const days = typeof input.inactiveDays === "number" ? input.inactiveDays : typeof input.inactiveDays === "string" ? Number(input.inactiveDays) : NaN;
  if (Number.isFinite(days) && days >= 1) out.inactiveDays = Math.min(Math.floor(days), MAX_INACTIVE_DAYS);
  if (typeof input.purchased === "boolean") out.purchased = input.purchased;
  return out;
}

/** Course ids a filter refers to (both "enrolled in" and "not enrolled in"). */
function segmentCourseRefs(input: Record<string, unknown>): unknown[] | null {
  const refs: unknown[] = [];
  for (const key of ["courseIds", "notEnrolledCourseIds"] as const) {
    const value = input[key];
    if (value === undefined) continue;
    if (!Array.isArray(value)) return null;
    refs.push(...value);
  }
  return refs;
}

/**
 * Why a submitted audience can't be saved (null when it can). Normalizing
 * drops anything it can't use, and an empty filter means every eligible
 * member, so a field that doesn't parse, or a course that was deleted in the
 * meantime, would otherwise quietly widen the audience. Fails closed instead.
 */
export function segmentInputProblem(raw: unknown, knownCourseIds: ReadonlySet<string>): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "The audience couldn't be read. Choose it again, then save.";
  const refs = segmentCourseRefs(raw as Record<string, unknown>);
  if (!refs) return "The audience couldn't be read. Choose it again, then save.";
  if (refs.some((id) => typeof id !== "string" || !knownCourseIds.has(id))) return "A course in this audience no longer exists. Choose the courses again, then save.";
  return null;
}

/** How many course conditions of a stored filter point at courses that no longer exist. */
export function staleSegmentCourses(filter: SegmentFilter, knownCourseIds: ReadonlySet<string>): number {
  const refs = segmentCourseRefs(filter as unknown as Record<string, unknown>) ?? [];
  return refs.filter((id) => typeof id !== "string" || !knownCourseIds.has(id)).length;
}

/** Whether the filter selects every eligible member (no condition set). */
export function isEmptySegment(filter: SegmentFilter): boolean {
  return !filter.leadsOnly && !filter.courseIds?.length && !filter.notEnrolledCourseIds?.length && !filter.roles?.length && !filter.inactiveDays && filter.purchased === undefined;
}

/** Most recent sign of life per user: account activity, lesson progress, sign-up. */
export function lastActivityByUser(source: Pick<SegmentSource, "users" | "activities" | "progress">): Map<string, number> {
  const last = new Map<string, number>();
  const bump = (userId: string, iso: string | undefined) => {
    if (!iso) return;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return;
    if (t > (last.get(userId) ?? -Infinity)) last.set(userId, t);
  };
  for (const u of source.users) {
    bump(u.id, u.createdAt);
    bump(u.id, u.lastActiveAt);
  }
  for (const a of source.activities) bump(a.userId, a.createdAt);
  for (const p of source.progress) bump(p.userId, p.updatedAt);
  return last;
}

export function firstNameOf(name: string | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

function emptyExclusions(): SegmentExclusions {
  return { unsubscribed: 0, disabled: 0, unconfirmed: 0, invalid: 0, duplicate: 0 };
}

/** Members may receive marketing email unless they switched announcements off. */
export function acceptsMarketing(user: Pick<User, "emailPreferences">): boolean {
  return user.emailPreferences?.announcements !== false;
}

/** Why somebody who matches a segment still can't be emailed. */
export type DeliveryBlock = Exclude<keyof SegmentExclusions, "duplicate">;

/**
 * The rule that keeps a member out of marketing email, or null when they can
 * receive it. Shared by segments, the broadcast sender (re-checked right
 * before each batch) and the sequence runner.
 */
export function memberBlock(user: Pick<SegmentUser, "email" | "enabled" | "emailPreferences" | "emailVerifiedAt" | "emailVerificationRequired">): DeliveryBlock | null {
  if (!user.enabled) return "disabled";
  if (!isValidEmail(user.email.trim().toLowerCase())) return "invalid";
  if (user.emailVerificationRequired && !user.emailVerifiedAt) return "unconfirmed";
  if (!acceptsMarketing(user)) return "unsubscribed";
  return null;
}

/** Like `memberBlock`, for a lead: consent, double opt-in and no unsubscribe. */
export function leadBlock(lead: Pick<Lead, "email" | "consent" | "confirmedAt" | "unsubscribedAt">): DeliveryBlock | null {
  if (lead.unsubscribedAt) return "unsubscribed";
  if (!isValidEmail(lead.email.trim().toLowerCase())) return "invalid";
  if (!lead.consent || !lead.confirmedAt) return "unconfirmed";
  return null;
}

export function memberRecipient(user: Pick<SegmentUser, "id" | "name" | "email">): SegmentRecipient {
  return { kind: "member", id: user.id, email: user.email.trim().toLowerCase(), name: user.name, firstName: firstNameOf(user.name) };
}

export function leadRecipient(lead: Pick<Lead, "id" | "name" | "email">): SegmentRecipient {
  const name = lead.name?.trim() ?? "";
  return { kind: "lead", id: lead.id, email: lead.email.trim().toLowerCase(), name, firstName: firstNameOf(name) };
}

function evaluateMembers(source: SegmentSource, filter: SegmentFilter, now: number, result: SegmentResult, seen: Set<string>) {
  const want = filter.courseIds?.length ? new Set(filter.courseIds) : null;
  const avoid = filter.notEnrolledCourseIds?.length ? new Set(filter.notEnrolledCourseIds) : null;
  const enrolledIn = new Set<string>();
  const enrolledAvoided = new Set<string>();
  if (want || avoid) {
    for (const e of source.enrollments) {
      if (want?.has(e.courseId)) enrolledIn.add(e.userId);
      if (avoid?.has(e.courseId)) enrolledAvoided.add(e.userId);
    }
  }
  const paid = filter.purchased === undefined ? null : new Set(source.payments.filter((p) => p.status === "paid").map((p) => p.userId));
  const roles = filter.roles?.length ? new Set(filter.roles) : null;
  const lastActive = filter.inactiveDays ? lastActivityByUser(source) : null;
  const inactiveBefore = filter.inactiveDays ? now - filter.inactiveDays * 86_400_000 : 0;

  for (const user of source.users) {
    if (want && !enrolledIn.has(user.id)) continue;
    if (avoid && enrolledAvoided.has(user.id)) continue;
    if (roles && !user.roles.some((r) => roles.has(r))) continue;
    if (paid && paid.has(user.id) !== filter.purchased) continue;
    if (lastActive && (lastActive.get(user.id) ?? 0) > inactiveBefore) continue;

    const block = memberBlock(user);
    const recipient = memberRecipient(user);
    if (block) result.excluded[block]++;
    else if (seen.has(recipient.email)) result.excluded.duplicate++;
    else {
      seen.add(recipient.email);
      result.recipients.push(recipient);
    }
  }
}

function evaluateLeads(source: SegmentSource, filter: SegmentFilter, result: SegmentResult, seen: Set<string>) {
  const memberEmails = new Set(source.users.map((u) => u.email.trim().toLowerCase()));
  const interested = filter.courseIds?.length ? new Set(filter.courseIds) : null;
  for (const lead of source.leads) {
    const email = lead.email.trim().toLowerCase();
    // People who created an account are members now; they're reached through member segments.
    if (memberEmails.has(email)) continue;
    if (interested && (!lead.courseId || !interested.has(lead.courseId))) continue;
    const block = leadBlock(lead);
    if (block) result.excluded[block]++;
    else if (seen.has(email)) result.excluded.duplicate++;
    else {
      seen.add(email);
      result.recipients.push(leadRecipient(lead));
    }
  }
}

/** Everyone the segment reaches, in a stable order (by name, then address). */
export function evaluateSegment(source: SegmentSource, raw: SegmentFilter, now: number = Date.now()): SegmentResult {
  const filter = normalizeSegmentFilter(raw);
  const result: SegmentResult = { recipients: [], excluded: emptyExclusions() };
  const seen = new Set<string>();
  if (filter.leadsOnly) evaluateLeads(source, filter, result, seen);
  else evaluateMembers(source, filter, now, result, seen);
  result.recipients.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "en", { sensitivity: "base" }) || a.email.localeCompare(b.email));
  return result;
}

export function totalExcluded(excluded: SegmentExclusions): number {
  return excluded.unsubscribed + excluded.disabled + excluded.unconfirmed + excluded.invalid + excluded.duplicate;
}

/* ------------------------------------------------------------------ */
/* Describing and sharing a segment                                    */
/* ------------------------------------------------------------------ */

function listTitles(ids: readonly string[], titleOf: (id: string) => string | undefined): string {
  const titles = ids.map((id) => titleOf(id) ?? "a deleted course");
  if (titles.length <= 3) return titles.join(", ");
  return `${titles.slice(0, 3).join(", ")} and ${titles.length - 3} more`;
}

/** Human-readable conditions, e.g. ["Members", "Enrolled in Python 101", "Inactive for 30+ days"]. */
export function describeSegment(raw: SegmentFilter, titleOf: (courseId: string) => string | undefined): string[] {
  const filter = normalizeSegmentFilter(raw);
  if (filter.leadsOnly) {
    const parts = ["Leads without an account"];
    if (filter.courseIds?.length) parts.push(`Interested in ${listTitles(filter.courseIds, titleOf)}`);
    return parts;
  }
  const parts: string[] = [];
  if (filter.roles?.length) {
    parts.push(filter.roles.map((r) => SEGMENT_ROLE_OPTIONS.find((o) => o.value === r)?.label ?? r).join(" or "));
  } else {
    parts.push("All members");
  }
  if (filter.courseIds?.length) parts.push(`Enrolled in ${filter.courseIds.length > 1 ? "any of " : ""}${listTitles(filter.courseIds, titleOf)}`);
  if (filter.notEnrolledCourseIds?.length) parts.push(`Not enrolled in ${listTitles(filter.notEnrolledCourseIds, titleOf)}`);
  if (filter.inactiveDays) parts.push(`Inactive for ${filter.inactiveDays}+ ${filter.inactiveDays === 1 ? "day" : "days"}`);
  if (filter.purchased === true) parts.push("Has made a purchase");
  if (filter.purchased === false) parts.push("Never purchased");
  return parts;
}

/**
 * Compact base64url form for URLs (`?segment=`), e.g. to open the broadcast
 * composer with an audience. A normalized filter is plain ASCII (ids, role
 * names, numbers), so `btoa`/`atob` work on the server and in the browser.
 */
export function encodeSegmentParam(filter: SegmentFilter): string {
  return btoa(JSON.stringify(normalizeSegmentFilter(filter))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSegmentParam(value: string | null | undefined, knownCourseIds?: ReadonlySet<string>): SegmentFilter {
  if (!value || value.length > 8_000 || !/^[A-Za-z0-9_-]+$/.test(value)) return {};
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    return normalizeSegmentFilter(JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))), knownCourseIds);
  } catch {
    return {};
  }
}

export const SEGMENT_CSV_HEADER = ["Email", "Name", "Type"];

export function segmentCsvRows(recipients: readonly SegmentRecipient[]): string[][] {
  return [SEGMENT_CSV_HEADER, ...recipients.map((r) => [r.email, r.name, r.kind === "lead" ? "Lead" : "Member"])];
}
