import type { Course, Enrollment, Organization, OrgSeat, Payment } from "@/lib/types";
import { isValidEmail } from "@/lib/utils";
import { pageParam, param, type SearchParamsLike } from "./affiliates-shared";

/**
 * Team (B2B seats) rules shared by the server, the client forms and the
 * tests (growth area). Pure: no store, no Next or Node APIs.
 *
 * A company buys seats for a set of courses. Each seat is assigned to one
 * person by email; accepting the invitation enrolls them in the team's
 * courses. Revoking a seat frees it for someone else and removes the course
 * access the seat granted.
 */

/** Seats one order can buy. */
export const MAX_SEATS_PER_ORDER = 500;
/** Upper bound for a team's seat count (administrators adjusting seats). */
export const MAX_TEAM_SEATS = 10_000;
/** Courses one team can include. */
export const MAX_TEAM_COURSES = 25;
/** Addresses accepted by one invite request. */
export const MAX_INVITES_PER_REQUEST = 200;
/** An invitation link works this long after it was (re)sent. */
export const INVITE_TTL_DAYS = 30;
/** The same invitation can be emailed again after this long. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const TEAM_NAME_MIN = 2;
export const TEAM_NAME_MAX = 80;
/** Managers besides the owner. */
export const MAX_TEAM_MANAGERS = 20;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A team name with control characters removed and whitespace collapsed, or null when it is too short or long. */
export function normalizeTeamName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return name.length >= TEAM_NAME_MIN && name.length <= TEAM_NAME_MAX ? name : null;
}

/* ------------------------------------------------------------------ */
/* Order reference (checkout hand-off)                                 */
/* ------------------------------------------------------------------ */

/**
 * The checkout item id of a seats order: `<orgId>-<seats>`, e.g.
 * `org_k2j9…-25`. `/team/buy` hands off to `/billing/seats/<ref>`; the order
 * keeps the reference as its `itemId` (and `orgId` / `seats` when the
 * checkout stamps them).
 */
export function seatsOrderRef(orgId: string, seats: number): string {
  return `${orgId}-${seats}`;
}

const ORDER_REF = /^([A-Za-z0-9_]{1,64})-([1-9]\d{0,3})$/;

export function parseSeatsOrderRef(ref: string | null | undefined): { orgId: string; seats: number } | null {
  const match = typeof ref === "string" ? ORDER_REF.exec(ref) : null;
  if (!match) return null;
  const seats = Number(match[2]);
  return seats <= MAX_SEATS_PER_ORDER ? { orgId: match[1], seats } : null;
}

/** The team and seat count a seats order pays for (from its own fields, else from its item reference). */
export function seatsOrderOf(payment: Pick<Payment, "itemType" | "itemId" | "orgId" | "seats">): { orgId: string; seats: number } | null {
  if (payment.itemType !== "seats") return null;
  const parsed = parseSeatsOrderRef(payment.itemId);
  const orgId = payment.orgId || parsed?.orgId || payment.itemId;
  const seats = payment.seats ?? parsed?.seats;
  if (!orgId || seats === undefined || !Number.isInteger(seats) || seats < 1 || seats > MAX_TEAM_SEATS) return null;
  return { orgId, seats };
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

export type TeamCourse = Pick<Course, "id" | "title" | "price" | "currency" | "paidCourse" | "published" | "upcoming">;

/** Courses a new team can choose: published, open and sold for a price. */
export function isSeatCourse(course: Pick<Course, "price" | "paidCourse" | "published" | "upcoming">): boolean {
  return course.published && !course.upcoming && course.paidCourse && course.price > 0;
}

export function parseSeatCount(raw: unknown, max: number = MAX_SEATS_PER_ORDER): number | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,5}$/.test(text)) return null;
  const n = Number(text);
  return n >= 1 && n <= max ? n : null;
}

export interface SeatsQuote {
  seats: number;
  /** Price of one seat: the sum of the courses' prices. */
  unitAmount: number;
  amount: number;
  currency: string;
  lines: { courseId: string; title: string; price: number }[];
}

export type SeatsQuoteResult = { ok: true; quote: SeatsQuote } | { ok: false; error: string };

/**
 * Price `seats` seats for `courses`. One seat costs what the courses cost
 * together; courses without a price add nothing. Every priced course must be
 * sold in the same currency.
 */
export function quoteSeats(courses: readonly Pick<Course, "id" | "title" | "price" | "currency" | "paidCourse">[], seats: number): SeatsQuoteResult {
  if (!Number.isInteger(seats) || seats < 1 || seats > MAX_SEATS_PER_ORDER) {
    return { ok: false, error: `Choose between 1 and ${MAX_SEATS_PER_ORDER} seats.` };
  }
  const priced = courses.filter((c) => c.paidCourse && c.price > 0);
  if (!priced.length) return { ok: false, error: "Choose at least one paid course. Free courses don't need seats." };
  const currencies = new Set(priced.map((c) => (c.currency || "USD").toUpperCase()));
  if (currencies.size > 1) return { ok: false, error: "These courses are sold in different currencies. Choose courses priced in one currency." };
  const unitAmount = priced.reduce((sum, c) => sum + Math.round(c.price), 0);
  return {
    ok: true,
    quote: {
      seats,
      unitAmount,
      amount: unitAmount * seats,
      currency: [...currencies][0],
      lines: priced.map((c) => ({ courseId: c.id, title: c.title, price: Math.round(c.price) })),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Seats                                                               */
/* ------------------------------------------------------------------ */

export interface SeatUsage {
  total: number;
  active: number;
  /** Invitations sent and not accepted yet (expired ones included: they hold their seat until revoked). */
  invited: number;
  used: number;
  available: number;
  /** Seats in use beyond the team's seat count (after seats were removed). */
  over: number;
}

export function seatUsage(org: Pick<Organization, "seatCount">, seats: readonly Pick<OrgSeat, "status">[]): SeatUsage {
  let active = 0;
  let invited = 0;
  for (const seat of seats) {
    if (seat.status === "active") active++;
    else if (seat.status === "invited") invited++;
  }
  const total = Math.max(0, org.seatCount);
  const used = active + invited;
  return { total, active, invited, used, available: Math.max(0, total - used), over: Math.max(0, used - total) };
}

/** Epoch ms after which an invitation link stops working. */
export function inviteExpiresAt(seat: Pick<OrgSeat, "assignedAt">): number {
  const sent = Date.parse(seat.assignedAt);
  return (Number.isFinite(sent) ? sent : 0) + INVITE_TTL_DAYS * DAY_MS;
}

export type SeatState = "active" | "invited" | "expired" | "revoked";

/** A seat's status with expired invitations called out. */
export function seatState(seat: Pick<OrgSeat, "status" | "assignedAt">, now: number = Date.now()): SeatState {
  if (seat.status !== "invited") return seat.status;
  return inviteExpiresAt(seat) <= now ? "expired" : "invited";
}

export const SEAT_STATE_LABELS: Record<SeatState, string> = {
  active: "Active",
  invited: "Invited",
  expired: "Invitation expired",
  revoked: "Revoked",
};

/** "owner", "manager" or null for a member who cannot manage the team. */
export function orgRole(org: Pick<Organization, "ownerId" | "managerIds">, userId: string | null | undefined): "owner" | "manager" | null {
  if (!userId) return null;
  if (org.ownerId === userId) return "owner";
  return org.managerIds.includes(userId) ? "manager" : null;
}

/**
 * A team that was started at `/team/buy` but never paid for: no seats, no
 * assignments. It is hidden from lists until its first order is paid.
 */
export function isDraftTeam(org: Pick<Organization, "seatCount">, seatRows: number, settledOrders: number): boolean {
  return org.seatCount <= 0 && seatRows === 0 && settledOrders === 0;
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

export interface InviteEntry {
  email: string;
  name?: string;
}

export interface ParsedInvites {
  entries: InviteEntry[];
  /** Rows that contain no usable email address (trimmed for display). */
  invalid: string[];
  /** Addresses listed more than once (counted once in `entries`). */
  duplicates: number;
  /** More addresses than one request accepts: the rest were dropped. */
  truncated: boolean;
}

function cleanEmail(raw: string): string | null {
  const email = raw.trim().replace(/^mailto:/i, "").toLowerCase();
  return email.length <= 200 && isValidEmail(email) ? email : null;
}

function cleanName(raw: string): string | undefined {
  const name = raw.replace(/[\u0000-\u001f\u007f<>"]+/g, " ").replace(/\s+/g, " ").trim();
  return name ? name.slice(0, 80) : undefined;
}

/** Split one row into cells on commas, semicolons and tabs; double-quoted cells may contain separators. */
function splitCells(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"' && !current.trim()) {
      quoted = true;
      current = "";
    } else if (ch === "," || ch === ";" || ch === "\t") {
      cells.push(current.trim());
      current = "";
    } else current += ch;
  }
  cells.push(current.trim());
  return cells;
}

const ANGLE_FORM = /([^<>,;\t]*)<([^<>\s]+)>/g;

/**
 * Read addresses pasted into the invite box or uploaded as a CSV file.
 * Accepted per row: `email`, `Name <email>`, `email, name`, `name, email`
 * (comma, semicolon or tab separated, quotes allowed), or several addresses
 * separated by commas, semicolons or spaces. A header row is ignored.
 */
export function parseInviteList(text: string, max: number = MAX_INVITES_PER_REQUEST): ParsedInvites {
  const byEmail = new Map<string, InviteEntry>();
  const invalid: string[] = [];
  let duplicates = 0;
  let truncated = false;

  const add = (email: string, name?: string) => {
    const existing = byEmail.get(email);
    if (existing) {
      duplicates++;
      if (!existing.name && name) existing.name = name;
      return;
    }
    if (byEmail.size >= max) {
      truncated = true;
      return;
    }
    byEmail.set(email, name ? { email, name } : { email });
  };

  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    // "Ada Lovelace <ada@example.com>, Bob <bob@example.com>"
    if (line.includes("<")) {
      let found = false;
      for (const match of line.matchAll(ANGLE_FORM)) {
        const email = cleanEmail(match[2]);
        if (!email) continue;
        found = true;
        add(email, cleanName(match[1]));
      }
      if (found) return;
    }
    let cells = splitCells(line).filter(Boolean);
    // "a@x.com b@y.com" on one row.
    if (cells.length === 1 && /\s/.test(cells[0]) && cells[0].split(/\s+/).every((token) => cleanEmail(token))) cells = cells[0].split(/\s+/);
    const emails = cells.map(cleanEmail);
    const found = emails.filter((e): e is string => !!e);
    if (!found.length) {
      const header = index === 0 && cells.some((cell) => /^(e-?mail|email address|name|full name)$/i.test(cell));
      if (!header && invalid.length < 50) invalid.push(line.length > 60 ? `${line.slice(0, 59)}…` : line);
      return;
    }
    if (found.length === 1) {
      const name = cleanName(cells.filter((_, i) => !emails[i]).join(" "));
      add(found[0], name);
      return;
    }
    for (const email of found) add(email);
  });

  return { entries: [...byEmail.values()], invalid, duplicates, truncated };
}

export type InviteSkipReason = "already_member" | "already_invited" | "no_seats";

export const INVITE_SKIP_LABELS: Record<InviteSkipReason, string> = {
  already_member: "already on the team",
  already_invited: "already invited",
  no_seats: "no seat left",
};

export interface InvitePlan {
  invite: InviteEntry[];
  skipped: { email: string; reason: InviteSkipReason }[];
}

/**
 * Decide who gets an invitation: people who already hold a seat (by the
 * address they were invited at or their account address) are skipped, and
 * invitations stop when the free seats run out (in list order).
 */
export function planInvites(
  entries: readonly InviteEntry[],
  taken: readonly { status: OrgSeat["status"]; emails: readonly (string | undefined)[] }[],
  available: number,
): InvitePlan {
  const members = new Set<string>();
  const invited = new Set<string>();
  for (const seat of taken) {
    if (seat.status === "revoked") continue;
    for (const email of seat.emails) if (email) (seat.status === "active" ? members : invited).add(email.toLowerCase());
  }
  const plan: InvitePlan = { invite: [], skipped: [] };
  let left = Math.max(0, available);
  for (const entry of entries) {
    const email = entry.email.toLowerCase();
    if (members.has(email)) plan.skipped.push({ email, reason: "already_member" });
    else if (invited.has(email)) plan.skipped.push({ email, reason: "already_invited" });
    else if (left <= 0) plan.skipped.push({ email, reason: "no_seats" });
    else {
      plan.invite.push({ ...entry, email });
      invited.add(email);
      left--;
    }
  }
  return plan;
}

/** "3 invitations sent. 2 skipped: a@x.com (already invited), b@x.com (no seat left)." */
export function inviteSummary(sent: number, skipped: InvitePlan["skipped"]): string {
  const head = sent === 0 ? "No invitations sent." : `${sent} ${sent === 1 ? "invitation" : "invitations"} sent.`;
  if (!skipped.length) return head;
  const shown = skipped.slice(0, 5).map((s) => `${s.email} (${INVITE_SKIP_LABELS[s.reason]})`);
  const more = skipped.length > shown.length ? ` and ${skipped.length - shown.length} more` : "";
  return `${head} ${skipped.length} skipped: ${shown.join(", ")}${more}.`;
}

/* ------------------------------------------------------------------ */
/* Removing seats                                                      */
/* ------------------------------------------------------------------ */

/**
 * Whether revoking a seat removes this course enrollment. Only enrollments
 * the seat itself created go: the learner must have joined the course after
 * taking the seat, without an order, batch or other team behind it. Finished
 * courses and free courses are always kept.
 */
export function seatEnrollmentRevocable(input: {
  enrollment: Pick<Enrollment, "memberType" | "enrolledAt" | "paymentId" | "batchId" | "completedAt">;
  /** When the member took the seat. */
  activatedAt: string | undefined;
  coursePaid: boolean;
  /** The member has another right to the course: a paid order, a batch seat or a running membership. */
  ownAccess: boolean;
  /** The member holds an active seat in another team that includes the course. */
  otherTeamSeat: boolean;
}): boolean {
  const { enrollment, activatedAt } = input;
  if (enrollment.memberType !== "student" || enrollment.completedAt) return false;
  if (!input.coursePaid || input.ownAccess || input.otherTeamSeat) return false;
  if (enrollment.paymentId || enrollment.batchId || !activatedAt) return false;
  return enrollment.enrolledAt >= activatedAt;
}

/**
 * Seats to revoke so that at most `capacity` stay in use (after a refund
 * removed seats): open invitations first, then members, newest first.
 */
export function planSeatReduction(seats: readonly Pick<OrgSeat, "id" | "status" | "assignedAt" | "activatedAt">[], capacity: number): string[] {
  const inUse = seats.filter((s) => s.status !== "revoked");
  let excess = inUse.length - Math.max(0, capacity);
  if (excess <= 0) return [];
  const newestFirst = (a: string | undefined, b: string | undefined) => (b ?? "").localeCompare(a ?? "");
  const order = [
    ...inUse.filter((s) => s.status === "invited").sort((a, b) => newestFirst(a.assignedAt, b.assignedAt)),
    ...inUse.filter((s) => s.status === "active").sort((a, b) => newestFirst(a.activatedAt ?? a.assignedAt, b.activatedAt ?? b.assignedAt)),
  ];
  const out: string[] = [];
  for (const seat of order) {
    if (excess <= 0) break;
    out.push(seat.id);
    excess--;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Progress                                                            */
/* ------------------------------------------------------------------ */

export type CourseProgressState = "not_started" | "in_progress" | "completed";

export const PROGRESS_STATE_LABELS: Record<CourseProgressState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export function progressState(progress: number, completedAt?: string): CourseProgressState {
  if (completedAt || progress >= 100) return "completed";
  return progress > 0 ? "in_progress" : "not_started";
}

/** One member's standing in one of the team's courses. */
export interface MemberCourseProgress {
  courseId: string;
  /** False when the member is not enrolled in the course (yet). */
  enrolled: boolean;
  /** 0-100 */
  progress: number;
  state: CourseProgressState;
  lessonsDone: number;
  lessonsTotal: number;
  timeSpentSeconds: number;
  lastActivityAt?: string;
  completedAt?: string;
  certificateCode?: string;
}

/** Mean progress over the given courses, rounded (0 without courses). */
export function averageProgress(rows: readonly Pick<MemberCourseProgress, "progress">[]): number {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((sum, r) => sum + Math.min(100, Math.max(0, r.progress)), 0) / rows.length);
}

/* ------------------------------------------------------------------ */
/* List filters (URL search params)                                    */
/* ------------------------------------------------------------------ */

/** "current" = every seat in use (active, invited, expired). */
export const SEAT_FILTER_STATUSES = ["current", "active", "invited", "expired", "revoked"] as const;
export type SeatFilterStatus = (typeof SEAT_FILTER_STATUSES)[number];

export interface SeatFilter {
  status: SeatFilterStatus;
  q: string;
  page: number;
}

export function parseSeatFilter(sp: SearchParamsLike): SeatFilter {
  const status = param(sp, "status");
  return {
    status: (SEAT_FILTER_STATUSES as readonly string[]).includes(status) ? (status as SeatFilterStatus) : "current",
    q: param(sp, "q").trim().slice(0, 120),
    page: pageParam(sp),
  };
}

export function seatMatchesFilter(state: SeatState, status: SeatFilterStatus): boolean {
  return status === "current" ? state !== "revoked" : state === status;
}

export const PROGRESS_FILTER_STATES = ["all", "not_started", "in_progress", "completed"] as const;

export interface ProgressFilter {
  /** Course id, or "" for every course of the team. */
  courseId: string;
  state: CourseProgressState | "all";
  q: string;
  page: number;
}

export function parseProgressFilter(sp: SearchParamsLike): ProgressFilter {
  const state = param(sp, "state");
  const course = param(sp, "course");
  return {
    courseId: /^[A-Za-z0-9_-]{1,64}$/.test(course) ? course : "",
    state: (PROGRESS_FILTER_STATES as readonly string[]).includes(state) ? (state as ProgressFilter["state"]) : "all",
    q: param(sp, "q").trim().slice(0, 120),
    page: pageParam(sp),
  };
}

/** Admin list: "active" teams have seats, "pending" ones wait for their first payment, "full" ones have no free seat. */
export const TEAM_FILTER_STATUSES = ["all", "active", "pending", "full"] as const;
export type TeamFilterStatus = (typeof TEAM_FILTER_STATUSES)[number];

export interface TeamFilter {
  status: TeamFilterStatus;
  q: string;
  page: number;
}

export function parseTeamFilter(sp: SearchParamsLike): TeamFilter {
  const status = param(sp, "status");
  return {
    status: (TEAM_FILTER_STATUSES as readonly string[]).includes(status) ? (status as TeamFilterStatus) : "all",
    q: param(sp, "q").trim().slice(0, 120),
    page: pageParam(sp),
  };
}
