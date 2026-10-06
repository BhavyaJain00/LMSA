import "server-only";
import type { Course, Database, Organization, OrgSeat, Payment, User } from "@/lib/types";
import type { DomainEventMap } from "@/lib/events";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { safeEqual } from "@/lib/auth/crypto";
import { generateRawToken, hashAuthToken, isWellFormedToken } from "@/lib/auth/tokens";
import { resolveCourseAccess } from "@/lib/commerce/access";
import { enrollUserInCourse, unenrollUserFromCourse } from "@/lib/services/enrollment";
import { notify, notifyMany } from "@/lib/services/notifications";
import { toCsv } from "@/components/admin/settings/member-import-csv";
import { plural } from "@/components/catalog/format";
import { formatPrice, pluralize, uid, uniqueSlug } from "@/lib/utils";
import { sumByCurrency } from "./affiliates";
import { sendTeamInvitations, type TeamInvitation } from "./team-emails";
import {
  MAX_TEAM_COURSES,
  MAX_TEAM_MANAGERS,
  MAX_TEAM_SEATS,
  PROGRESS_STATE_LABELS,
  RESEND_COOLDOWN_MS,
  SEAT_STATE_LABELS,
  averageProgress,
  inviteExpiresAt,
  isDraftTeam,
  isSeatCourse,
  orgRole,
  parseSeatsOrderRef,
  planInvites,
  planSeatReduction,
  progressState,
  quoteSeats,
  seatEnrollmentRevocable,
  seatMatchesFilter,
  seatState,
  seatUsage,
  seatsOrderOf,
  seatsOrderRef,
  type InviteEntry,
  type InvitePlan,
  type MemberCourseProgress,
  type ProgressFilter,
  type SeatFilter,
  type SeatState,
  type SeatUsage,
  type SeatsQuote,
  type TeamFilter,
} from "./teams-shared";

/**
 * Teams / B2B seats on the server (growth area).
 *
 * A company picks courses and a number of seats at `/team/buy`. That creates
 * a draft `Organization` (no seats yet) and hands off to the checkout with an
 * order reference (`seatsOrderRef`). When the order is paid (`payment.paid`,
 * see `handlers.ts`) the seats are added and the buyer manages the team at
 * `/team`: each seat is assigned by email with a single-use invitation link
 * (`/join/<token>`, only its SHA-256 hash is stored); accepting it enrolls
 * the member in the team's courses. Revoking a seat frees it and removes the
 * course access it granted.
 */

export const TEAM_PAGE_SIZE = 25;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Drafts that were never paid for are cleared after this long. */
const DRAFT_TTL_MS = 30 * DAY_MS;

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export interface TeamUserView {
  id: string;
  name: string;
  email: string;
  username: string;
  avatarUrl?: string;
}

function userView(u: User | undefined): TeamUserView | null {
  return u ? { id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl } : null;
}

function adminIds(db: Pick<Database, "users">): string[] {
  return db.users.filter((u) => u.enabled && u.roles.includes("admin")).map((u) => u.id);
}

/** A team by id or slug. */
export function findTeam(db: Pick<Database, "organizations">, ref: string | null | undefined): Organization | undefined {
  if (!ref) return undefined;
  return db.organizations.find((o) => o.id === ref || o.slug === ref);
}

/** Seats orders of a team, any status. */
function teamOrders(db: Pick<Database, "payments">, orgId: string): Payment[] {
  return db.payments.filter((p) => p.itemType === "seats" && seatsOrderOf(p)?.orgId === orgId);
}

/** An unpaid checkout draft old enough to be cleared. */
function isStaleDraft(org: Pick<Organization, "createdAt">, nowMs: number): boolean {
  const created = Date.parse(org.createdAt);
  return Number.isFinite(created) && nowMs - created > DRAFT_TTL_MS;
}

function isDraft(db: Pick<Database, "payments" | "orgSeats">, org: Organization): boolean {
  if (org.seatCount > 0) return false;
  const seatRows = db.orgSeats.filter((s) => s.orgId === org.id).length;
  const settled = teamOrders(db, org.id).filter((p) => p.status === "paid" || p.status === "refunded").length;
  return isDraftTeam(org, seatRows, settled);
}

/** Everyone who manages the team (owner first). */
function managerIdsOf(org: Pick<Organization, "ownerId" | "managerIds">): string[] {
  return [org.ownerId, ...org.managerIds.filter((id) => id !== org.ownerId)];
}

function teamHref(org: Pick<Organization, "slug">, tab?: string): string {
  return `/team?org=${encodeURIComponent(org.slug)}${tab ? `&tab=${tab}` : ""}`;
}

export interface TeamCourseView {
  id: string;
  title: string;
  slug: string;
  price: number;
  currency: string;
  published: boolean;
}

function courseView(c: Course): TeamCourseView {
  return { id: c.id, title: c.title, slug: c.slug, price: c.paidCourse ? c.price : 0, currency: c.currency || "USD", published: c.published };
}

/** The team's courses that still exist, in the team's order. */
function teamCourses(db: Pick<Database, "courses">, org: Pick<Organization, "courseIds">): Course[] {
  const byId = new Map(db.courses.map((c) => [c.id, c]));
  return org.courseIds.map((id) => byId.get(id)).filter((c): c is Course => !!c);
}

/** Courses a new team can be bought for. */
export async function listSeatCourses(): Promise<TeamCourseView[]> {
  const db = await getDb();
  return db.courses
    .filter(isSeatCourse)
    .sort((a, b) => a.title.localeCompare(b.title))
    .map(courseView);
}

export interface ManagedTeam {
  org: Organization;
  role: "owner" | "manager";
  usage: SeatUsage;
  /** Started at /team/buy and not paid for yet. */
  draft: boolean;
}

/** Teams a member owns or manages: paid teams first, then by name. */
export async function getManagedTeams(userId: string): Promise<ManagedTeam[]> {
  const db = await getDb();
  const out: ManagedTeam[] = [];
  for (const org of db.organizations) {
    const role = orgRole(org, userId);
    if (!role) continue;
    out.push({ org: { ...org }, role, usage: seatUsage(org, db.orgSeats.filter((s) => s.orgId === org.id)), draft: isDraft(db, org) });
  }
  return out.sort((a, b) => Number(a.draft) - Number(b.draft) || a.org.name.localeCompare(b.org.name));
}

/* ------------------------------------------------------------------ */
/* Checkout hand-off                                                   */
/* ------------------------------------------------------------------ */

/** A seats order as the checkout needs it: what is bought, for which team, at what price. */
export interface SeatsOrder {
  /** Checkout item id (`seatsOrderRef`). */
  ref: string;
  org: Organization;
  seats: number;
  quote: SeatsQuote;
  /** Title stored on the payment and printed on the invoice. */
  title: string;
  description: string;
  /** The team has no seats yet: this order activates it. */
  firstPurchase: boolean;
}

export type SeatsOrderResult = { ok: true; order: SeatsOrder } | { ok: false; error: string };

/**
 * Resolve a checkout reference (`<orgId>-<seats>`) into a priced order. The
 * price is always computed here from the team's courses — never taken from
 * the browser. Synchronous over a snapshot so it can run inside `mutate`.
 */
export function resolveSeatsOrder(db: Pick<Database, "organizations" | "courses" | "payments" | "orgSeats">, ref: string): SeatsOrderResult {
  const parsed = parseSeatsOrderRef(ref);
  const org = parsed ? db.organizations.find((o) => o.id === parsed.orgId) : undefined;
  if (!parsed || !org) return { ok: false, error: "This team order does not exist. Start again from the team page." };
  if (org.seatCount + parsed.seats > MAX_TEAM_SEATS) return { ok: false, error: `A team can hold at most ${MAX_TEAM_SEATS} seats.` };
  const quoted = quoteSeats(teamCourses(db, org), parsed.seats);
  if (!quoted.ok) return { ok: false, error: quoted.error };
  const courseCount = quoted.quote.lines.length;
  return {
    ok: true,
    order: {
      ref: seatsOrderRef(org.id, parsed.seats),
      org: { ...org },
      seats: parsed.seats,
      quote: quoted.quote,
      title: `${parsed.seats} team ${plural(parsed.seats, "seat")} · ${org.name}`,
      description: `${formatPrice(quoted.quote.unitAmount, quoted.quote.currency)} per seat · ${pluralize(courseCount, "course")}`,
      firstPurchase: isDraft(db, org),
    },
  };
}

/** Why `user` cannot place this seats order, or null when they can. */
export function seatsPurchaseProblem(db: Pick<Database, "settings">, user: Pick<User, "id" | "roles">, order: SeatsOrder): string | null {
  if (!db.settings.growth.teamsEnabled) return "Team purchases are not available at the moment.";
  if (!orgRole(order.org, user.id) && !user.roles.includes("admin")) return "Only the managers of this team can buy seats for it.";
  return null;
}

export type StartPurchaseResult = { ok: true; org: Organization; ref: string; quote: SeatsQuote } | { ok: false; error: string; field?: "name" | "seats" | "courseIds" };

/**
 * First step of a new team purchase: store the company name and courses as a
 * draft team owned by the buyer and return the checkout reference. The
 * buyer's previous draft is reused unless an order was already placed for it
 * (its courses must not change under an open order).
 */
export async function startTeamPurchase(user: Pick<User, "id">, input: { name: string; courseIds: readonly string[]; seats: number }): Promise<StartPurchaseResult> {
  return mutate((d): StartPurchaseResult => {
    if (!d.settings.growth.teamsEnabled) return { ok: false, error: "Team purchases are not available at the moment." };
    const wanted = Array.from(new Set(input.courseIds)).slice(0, MAX_TEAM_COURSES + 1);
    if (!wanted.length) return { ok: false, error: "Choose at least one course for your team.", field: "courseIds" };
    if (wanted.length > MAX_TEAM_COURSES) return { ok: false, error: `Choose at most ${MAX_TEAM_COURSES} courses.`, field: "courseIds" };
    const courses = wanted.map((id) => d.courses.find((c) => c.id === id));
    if (courses.some((c) => !c || !isSeatCourse(c))) return { ok: false, error: "One of the selected courses is no longer available. Review your selection.", field: "courseIds" };
    const quoted = quoteSeats(courses as Course[], input.seats);
    if (!quoted.ok) return { ok: false, error: quoted.error, field: /seat/i.test(quoted.error) ? "seats" : "courseIds" };

    // Forget checkout drafts nobody paid for; keep the buyer's latest one to reuse. Only teams
    // started here qualify: teams created by administrators and drafts waiting for an invoice
    // (`checkoutDraft` cleared) are never removed or reused.
    const now = Date.now();
    const unpaidCheckoutDraft = (o: Organization) => o.checkoutDraft === true && isDraft(d, o) && !teamOrders(d, o.id).some((p) => p.status !== "failed");
    if (d.organizations.some((o) => unpaidCheckoutDraft(o) && isStaleDraft(o, now))) {
      d.organizations = d.organizations.filter((o) => !(unpaidCheckoutDraft(o) && isStaleDraft(o, now)));
    }
    let org = d.organizations.filter((o) => o.ownerId === user.id && unpaidCheckoutDraft(o)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (org) {
      org.name = input.name;
      org.courseIds = wanted;
    } else {
      org = {
        id: uid("org"),
        name: input.name,
        slug: uniqueSlug(input.name, d.organizations.map((o) => o.slug)),
        ownerId: user.id,
        managerIds: [],
        seatCount: 0,
        courseIds: wanted,
        createdAt: new Date().toISOString(),
        checkoutDraft: true,
      };
      d.organizations.push(org);
    }
    return { ok: true, org: { ...org }, ref: seatsOrderRef(org.id, input.seats), quote: quoted.quote };
  });
}

/**
 * Ask the administrators for an invoice instead of paying online (purchase
 * orders, bank transfers). They add the seats in Admin → Teams once paid.
 */
export async function requestTeamInvoice(user: Pick<User, "id" | "name" | "email">, order: SeatsOrder): Promise<void> {
  // The team now waits for an invoice (net-30/60 terms are common): it is no longer an abandoned checkout.
  await mutate((d) => {
    const org = d.organizations.find((o) => o.id === order.org.id);
    if (org?.checkoutDraft) delete org.checkoutDraft;
  });
  const db = await getDb();
  await notifyMany(adminIds(db), {
    type: "system",
    subject: `${order.org.name} asked for an invoice for ${order.seats} team ${plural(order.seats, "seat")}`,
    message: `${user.name} (${user.email}) wants to pay ${formatPrice(order.quote.amount, order.quote.currency)} by invoice (${order.description}). Add the seats in Teams once the payment arrives.`,
    link: `/admin/teams/${order.org.id}`,
    fromUserId: user.id,
    dedupeKey: `team-invoice:${order.org.id}:${order.seats}:${new Date().toISOString().slice(0, 10)}`,
  });
  await audit(user, "team.invoice_request", { type: "team", id: order.org.id }, { seats: order.seats, amount: order.quote.amount, currency: order.quote.currency });
}

/* ------------------------------------------------------------------ */
/* Orders: seats added on payment, removed on refund                   */
/* ------------------------------------------------------------------ */

export type SeatPurchaseOutcome = { applied: false; reason: "not_seats" | "not_paid" | "no_team" } | { applied: true; org: Organization; seats: number; first: boolean };

/**
 * Add the seats of a paid order to its team (`payment.paid`, emitted exactly
 * once per order). The buyer becomes a manager when they are not one yet.
 */
export async function applySeatPurchase(paymentId: string): Promise<SeatPurchaseOutcome> {
  const result = await mutate((d) => {
    const payment = d.payments.find((p) => p.id === paymentId);
    if (!payment || payment.itemType !== "seats") return { applied: false as const, reason: "not_seats" as const };
    if (payment.status !== "paid") return { applied: false as const, reason: "not_paid" as const };
    const order = seatsOrderOf(payment);
    const org = order ? d.organizations.find((o) => o.id === order.orgId) : undefined;
    if (!order || !org) return { applied: false as const, reason: "no_team" as const, orderId: payment.orderId, admins: adminIds(d) };
    const first = org.seatCount === 0;
    org.seatCount = Math.min(MAX_TEAM_SEATS, org.seatCount + order.seats);
    if (org.checkoutDraft) delete org.checkoutDraft;
    payment.orgId = org.id;
    payment.seats = order.seats;
    if (!orgRole(org, payment.userId) && d.users.some((u) => u.id === payment.userId)) org.managerIds.push(payment.userId);
    return { applied: true as const, org: { ...org, managerIds: [...org.managerIds] }, seats: order.seats, first, buyerId: payment.userId, orderId: payment.orderId };
  });

  if (!result.applied) {
    if (result.reason === "no_team") {
      await notifyMany(result.admins, {
        type: "system",
        subject: `Order ${result.orderId} paid for team seats, but the team no longer exists`,
        message: "No seats were added. Create the team in Teams and add the seats by hand, or refund the order.",
        link: `/admin/settings/transactions?search=${encodeURIComponent(result.orderId)}`,
        dedupeKey: `team-seats-missing:${paymentId}`,
      });
    }
    return { applied: false, reason: result.reason };
  }

  const { org, seats, first } = result;
  await notifyMany(managerIdsOf(org), {
    type: "system",
    subject: first ? `Your team ${org.name} is ready` : `${pluralize(seats, "seat")} added to ${org.name}`,
    message: first
      ? `${pluralize(seats, "seat")} ${seats === 1 ? "is" : "are"} waiting. Invite your team members to get them started.`
      : `The team now has ${pluralize(org.seatCount, "seat")}. Invite more members whenever you're ready.`,
    link: teamHref(org),
    dedupeKey: `team-seats:${paymentId}`,
  });
  await audit({ id: result.buyerId }, "team.seats_purchase", { type: "team", id: org.id }, { seats, seatCount: org.seatCount, orderId: result.orderId });
  return { applied: true, org, seats, first };
}

interface Removal {
  userId: string;
  courseId: string;
}

interface RevokedSeat {
  seatId: string;
  email: string;
  /** Member who held the seat (invitations that were never accepted have none). */
  userId?: string;
}

/**
 * Revoke a seat inside `mutate`: the seat is freed and, for a member, the
 * course enrollments the seat created are queued for removal (see
 * `seatEnrollmentRevocable`). The invitation hash is kept so an old link
 * explains that it was cancelled instead of looking mistyped.
 */
function revokeSeatIn(d: Database, seat: OrgSeat, removals: Removal[]): RevokedSeat {
  const wasActive = seat.status === "active";
  const userId = seat.userId;
  seat.status = "revoked";
  const revoked: RevokedSeat = { seatId: seat.id, email: seat.email, userId: wasActive ? userId : undefined };
  const org = d.organizations.find((o) => o.id === seat.orgId);
  if (!wasActive || !userId || !org) return revoked;
  for (const courseId of org.courseIds) {
    const enrollment = d.enrollments.find((e) => e.userId === userId && e.courseId === courseId);
    const course = d.courses.find((c) => c.id === courseId);
    if (!enrollment || !course) continue;
    const access = resolveCourseAccess(d, userId, courseId);
    const otherTeamSeat = d.orgSeats.some(
      (s) => s.id !== seat.id && s.userId === userId && s.status === "active" && d.organizations.some((o) => o.id === s.orgId && o.courseIds.includes(courseId)),
    );
    const revocable = seatEnrollmentRevocable({
      enrollment,
      activatedAt: seat.activatedAt,
      coursePaid: course.paidCourse && course.price > 0,
      ownAccess: access.via === "purchase" || access.via === "bundle" || access.via === "batch" || access.via === "installments" || !!access.membership,
      otherTeamSeat,
    });
    if (revocable) removals.push({ userId, courseId });
  }
  return revoked;
}

async function applyRemovals(removals: readonly Removal[]): Promise<void> {
  for (const r of removals) await unenrollUserFromCourse(r.userId, r.courseId);
}

async function notifyRevokedMembers(org: Pick<Organization, "name">, revoked: readonly RevokedSeat[], reason: string): Promise<void> {
  const userIds = revoked.map((r) => r.userId).filter((id): id is string => !!id);
  await notifyMany(Array.from(new Set(userIds)), {
    type: "system",
    subject: `Your seat in the ${org.name} team was removed`,
    message: reason,
    link: "/dashboard",
  });
}

/**
 * Take back the seats of a fully refunded order (`payment.refunded`). When
 * more seats are in use than remain, open invitations are revoked first,
 * then the newest members.
 */
export async function reverseSeatPurchase(data: DomainEventMap["payment.refunded"]): Promise<{ removed: number; revoked: number }> {
  if (data.itemType !== "seats" || !data.full) return { removed: 0, revoked: 0 };
  const removals: Removal[] = [];
  const result = await mutate((d) => {
    const payment = d.payments.find((p) => p.id === data.paymentId);
    const order = payment ? seatsOrderOf(payment) : null;
    const org = order ? d.organizations.find((o) => o.id === order.orgId) : undefined;
    if (!payment || !order || !org || payment.status !== "refunded") return null;
    const before = org.seatCount;
    org.seatCount = Math.max(0, org.seatCount - order.seats);
    const seats = d.orgSeats.filter((s) => s.orgId === org.id);
    const ids = new Set(planSeatReduction(seats, org.seatCount));
    const revoked = seats.filter((s) => ids.has(s.id)).map((s) => revokeSeatIn(d, s, removals));
    return { org: { ...org }, removed: before - org.seatCount, revoked, orderId: payment.orderId };
  });
  if (!result) return { removed: 0, revoked: 0 };
  await applyRemovals(removals);
  const { org, removed, revoked } = result;
  await notifyMany(managerIdsOf(org), {
    type: "system",
    subject: `${pluralize(removed, "seat")} removed from ${org.name} after a refund`,
    message: revoked.length
      ? `Order ${result.orderId} was refunded. ${pluralize(revoked.length, "seat")} in use had to be revoked; the team now has ${pluralize(org.seatCount, "seat")}.`
      : `Order ${result.orderId} was refunded. The team now has ${pluralize(org.seatCount, "seat")}.`,
    link: teamHref(org),
    dedupeKey: `team-refund:${data.paymentId}`,
  });
  await notifyRevokedMembers(org, revoked, "The team's seats were reduced. Courses you already finished stay in your account.");
  await audit(null, "team.seats_refund", { type: "team", id: org.id }, { removed, revoked: revoked.length, seatCount: org.seatCount, orderId: result.orderId });
  return { removed, revoked: revoked.length };
}

/* ------------------------------------------------------------------ */
/* Invitations                                                         */
/* ------------------------------------------------------------------ */

function newInvite(): { token: string; hash: string } {
  const token = generateRawToken();
  return { token, hash: hashAuthToken(token) };
}

/** Addresses that identify the holder of each seat (invited address and account address). */
function takenSeats(d: Pick<Database, "orgSeats" | "users">, orgId: string, exceptSeatId?: string): { status: OrgSeat["status"]; emails: (string | undefined)[] }[] {
  return d.orgSeats
    .filter((s) => s.orgId === orgId && s.id !== exceptSeatId)
    .map((s) => ({ status: s.status, emails: [s.email, s.userId ? d.users.find((u) => u.id === s.userId)?.email : undefined] }));
}

/** Invitations sent by a team in the last 24 hours (every assignment counts, revoked ones too). */
function invitesLastDay(d: Pick<Database, "orgSeats">, orgId: string, now: number): number {
  return d.orgSeats.filter((s) => s.orgId === orgId && now - Date.parse(s.assignedAt) < DAY_MS).length;
}

/** Daily invitation allowance: generous for real use, tight enough that seats cannot be cycled to send bulk mail. */
function dailyInviteLimit(org: Pick<Organization, "seatCount">): number {
  return Math.max(50, org.seatCount * 3);
}

function invitationContext(d: Pick<Database, "courses">, org: Organization, inviterName: string) {
  return { teamName: org.name, inviterName, courseTitles: teamCourses(d, org).map((c) => c.title) };
}

/** Tell invited people who already have a confirmed account, in the app (the email carries the link). */
async function notifyInvitedMembers(org: Pick<Organization, "name">, invites: readonly TeamInvitation[], inviter: Pick<User, "id" | "name">): Promise<void> {
  const userIds = invites.map((i) => i.userId).filter((id): id is string => !!id && id !== inviter.id);
  await notifyMany(userIds, {
    type: "system",
    subject: `${inviter.name} invited you to the ${org.name} team`,
    message: "Accept the invitation to get access to the team's courses.",
    link: "/team",
    fromUserId: inviter.id,
    email: false,
  });
}

/** The account that can accept an invitation to `email` without the emailed link: it confirmed that address. */
function confirmedAccount(d: Pick<Database, "users">, email: string): User | undefined {
  return d.users.find((u) => u.enabled && !!u.emailVerifiedAt && u.email.toLowerCase() === email);
}

export type InviteResult = { ok: true; sent: number; skipped: InvitePlan["skipped"] } | { ok: false; error: string };

/**
 * Assign free seats to the given addresses and email each an invitation.
 * People who already hold a seat are skipped; invitations stop when the
 * seats run out.
 */
export async function inviteMembers(orgId: string, inviter: Pick<User, "id" | "name">, entries: readonly InviteEntry[]): Promise<InviteResult> {
  const now = new Date();
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { error: "This team no longer exists." };
    const usage = seatUsage(org, d.orgSeats.filter((s) => s.orgId === org.id));
    const plan = planInvites(entries, takenSeats(d, org.id), usage.available);
    if (invitesLastDay(d, org.id, now.getTime()) + plan.invite.length > dailyInviteLimit(org)) {
      return { error: "This team sent a lot of invitations today. Try again tomorrow, or contact us if you need to invite more people now." };
    }
    const invites: TeamInvitation[] = plan.invite.map((entry) => {
      const { token, hash } = newInvite();
      d.orgSeats.push({ id: uid("seat"), orgId: org.id, email: entry.email, inviteTokenHash: hash, status: "invited", assignedAt: now.toISOString() });
      return { email: entry.email, name: entry.name, token, assignedAt: now.toISOString(), userId: confirmedAccount(d, entry.email)?.id };
    });
    return { org: { ...org }, invites, skipped: plan.skipped, context: invitationContext(d, org, inviter.name) };
  });
  if (outcome.error !== undefined) return { ok: false, error: outcome.error };
  const sent = await sendTeamInvitations(outcome.context, outcome.invites);
  await notifyInvitedMembers(outcome.org, outcome.invites, inviter);
  return { ok: true, sent, skipped: outcome.skipped };
}

/** Send an open (or expired) invitation again with a fresh link; the old link stops working. */
export async function resendInvites(orgId: string, seatIds: readonly string[], inviter: Pick<User, "id" | "name">): Promise<{ sent: number; tooSoon: number }> {
  const wanted = new Set(seatIds);
  const now = new Date();
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return null;
    const invites: TeamInvitation[] = [];
    let tooSoon = 0;
    for (const seat of d.orgSeats) {
      if (seat.orgId !== org.id || !wanted.has(seat.id) || seat.status !== "invited") continue;
      if (now.getTime() - Date.parse(seat.assignedAt) < RESEND_COOLDOWN_MS) {
        tooSoon++;
        continue;
      }
      const { token, hash } = newInvite();
      seat.inviteTokenHash = hash;
      seat.assignedAt = now.toISOString();
      invites.push({ email: seat.email, token, assignedAt: seat.assignedAt, userId: confirmedAccount(d, seat.email)?.id });
    }
    return { invites, tooSoon, context: invitationContext(d, org, inviter.name) };
  });
  if (!outcome) return { sent: 0, tooSoon: 0 };
  const sent = await sendTeamInvitations(outcome.context, outcome.invites);
  return { sent, tooSoon: outcome.tooSoon };
}

/** Revoke seats of a team: invitations are cancelled, members lose the access their seat gave them. */
export async function revokeSeats(orgId: string, seatIds: readonly string[]): Promise<{ revoked: number; members: number }> {
  const wanted = new Set(seatIds);
  const removals: Removal[] = [];
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return null;
    const revoked = d.orgSeats.filter((s) => s.orgId === org.id && wanted.has(s.id) && s.status !== "revoked").map((s) => revokeSeatIn(d, s, removals));
    return { org: { ...org }, revoked };
  });
  if (!outcome) return { revoked: 0, members: 0 };
  await applyRemovals(removals);
  await notifyRevokedMembers(outcome.org, outcome.revoked, "A team manager removed your seat. Courses you already finished stay in your account.");
  return { revoked: outcome.revoked.length, members: outcome.revoked.filter((r) => r.userId).length };
}

export type ReassignResult = { ok: true; from: string; to: string } | { ok: false; error: string };

/** Move a seat to someone else: the current holder is revoked and the new address invited, in one step. */
export async function reassignSeat(orgId: string, seatId: string, entry: InviteEntry, inviter: Pick<User, "id" | "name">): Promise<ReassignResult> {
  const now = new Date();
  const removals: Removal[] = [];
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    const seat = org ? d.orgSeats.find((s) => s.id === seatId && s.orgId === org.id) : undefined;
    if (!org || !seat || seat.status === "revoked") return { error: "This seat is no longer assigned." };
    const plan = planInvites([entry], takenSeats(d, org.id, seat.id), 1);
    if (!plan.invite.length) return { error: plan.skipped[0]?.reason === "already_member" ? `${entry.email} is already on the team.` : `${entry.email} already has an invitation.` };
    if (seat.email.toLowerCase() === entry.email) return { error: "This seat is already assigned to that address." };
    const revoked = revokeSeatIn(d, seat, removals);
    const { token, hash } = newInvite();
    d.orgSeats.push({ id: uid("seat"), orgId: org.id, email: entry.email, inviteTokenHash: hash, status: "invited", assignedAt: now.toISOString() });
    const invite: TeamInvitation = { email: entry.email, name: entry.name, token, assignedAt: now.toISOString(), userId: confirmedAccount(d, entry.email)?.id };
    return { org: { ...org }, revoked, invite, context: invitationContext(d, org, inviter.name) };
  });
  if (outcome.error !== undefined) return { ok: false, error: outcome.error };
  await applyRemovals(removals);
  await notifyRevokedMembers(outcome.org, [outcome.revoked], "A team manager gave your seat to someone else. Courses you already finished stay in your account.");
  await sendTeamInvitations(outcome.context, [outcome.invite]);
  await notifyInvitedMembers(outcome.org, [outcome.invite], inviter);
  return { ok: true, from: outcome.revoked.email, to: outcome.invite.email };
}

async function enrollInTeamCourses(userId: string, courseIds: readonly string[]): Promise<void> {
  // Instructors are not notified per member: a team can bring dozens of learners at once.
  for (const courseId of courseIds) await enrollUserInCourse(userId, courseId, { notifyInstructors: false });
}

export type JoinProblem = "invalid" | "expired" | "revoked" | "used" | "full" | "already_member" | "disabled";

export const JOIN_PROBLEM_MESSAGES: Record<JoinProblem, string> = {
  invalid: "This invitation link is not valid. Check that you opened the latest invitation email, or ask your team manager for a new one.",
  expired: "This invitation has expired. Ask your team manager to send it again.",
  revoked: "This invitation was cancelled. Ask your team manager for a new one.",
  used: "This invitation was already accepted.",
  full: "This team has no free seat right now. Ask your team manager to free one up.",
  already_member: "You already have a seat on this team.",
  disabled: "Your account can't accept invitations right now.",
};

/** The seat an invitation token belongs to (constant-time comparison over the stored hashes). */
function seatForToken(d: Pick<Database, "orgSeats">, rawToken: string): OrgSeat | undefined {
  if (!isWellFormedToken(rawToken)) return undefined;
  const hash = hashAuthToken(rawToken);
  let match: OrgSeat | undefined;
  for (const seat of d.orgSeats) {
    if (seat.inviteTokenHash && safeEqual(seat.inviteTokenHash, hash) && !match) match = seat;
  }
  return match;
}

function inviteProblem(seat: OrgSeat | undefined, now: number): JoinProblem | null {
  if (!seat) return "invalid";
  if (seat.status === "revoked") return "revoked";
  if (seat.status === "active") return "used";
  return inviteExpiresAt(seat) <= now ? "expired" : null;
}

export interface InvitePreview {
  seatId: string;
  /** Address the invitation was sent to. */
  email: string;
  expiresAt: string;
  team: { id: string; name: string };
  courses: TeamCourseView[];
}

export type InviteLookup = { ok: true; invite: InvitePreview } | { ok: false; problem: JoinProblem; teamName?: string; memberId?: string };

function previewOf(d: Pick<Database, "courses">, seat: OrgSeat, org: Organization): InvitePreview {
  return {
    seatId: seat.id,
    email: seat.email,
    expiresAt: new Date(inviteExpiresAt(seat)).toISOString(),
    team: { id: org.id, name: org.name },
    courses: teamCourses(d, org).map(courseView),
  };
}

/** What an invitation link offers, for the `/join/<token>` page. */
export async function lookupInvite(rawToken: string, now: Date = new Date()): Promise<InviteLookup> {
  const db = await getDb();
  const seat = seatForToken(db, rawToken);
  const org = seat ? db.organizations.find((o) => o.id === seat.orgId) : undefined;
  const problem = inviteProblem(org ? seat : undefined, now.getTime());
  if (problem || !seat || !org) return { ok: false, problem: problem ?? "invalid", teamName: org?.name, memberId: seat?.status === "active" ? seat.userId : undefined };
  return { ok: true, invite: previewOf(db, seat, org) };
}

/** Open invitations addressed to the member's confirmed email (shown on `/team`). */
export async function pendingInvitesFor(user: Pick<User, "id" | "email" | "emailVerifiedAt">, now: Date = new Date()): Promise<InvitePreview[]> {
  if (!user.emailVerifiedAt) return [];
  const db = await getDb();
  const email = user.email.toLowerCase();
  const out: InvitePreview[] = [];
  for (const seat of db.orgSeats) {
    if (seat.status !== "invited" || seat.email.toLowerCase() !== email || inviteExpiresAt(seat) <= now.getTime()) continue;
    const org = db.organizations.find((o) => o.id === seat.orgId);
    if (org) out.push(previewOf(db, seat, org));
  }
  return out;
}

export type AcceptResult = { ok: true; team: { id: string; name: string }; courses: TeamCourseView[] } | { ok: false; problem: JoinProblem };

/** Turn an invitation into the member's seat (inside one serialized write), then enroll them. */
async function activateSeat(find: (d: Database) => OrgSeat | undefined, user: Pick<User, "id" | "name">, now: Date): Promise<AcceptResult> {
  const outcome = await mutate((d) => {
    const seat = find(d);
    const org = seat ? d.organizations.find((o) => o.id === seat.orgId) : undefined;
    const problem = inviteProblem(org ? seat : undefined, now.getTime());
    if (problem || !seat || !org) return { problem: problem ?? ("invalid" as const) };
    const account = d.users.find((u) => u.id === user.id);
    if (!account?.enabled) return { problem: "disabled" as const };
    const seats = d.orgSeats.filter((s) => s.orgId === org.id);
    if (seats.some((s) => s.id !== seat.id && s.status === "active" && s.userId === user.id)) return { problem: "already_member" as const };
    if (seats.filter((s) => s.status === "active").length >= org.seatCount) return { problem: "full" as const };
    seat.userId = user.id;
    seat.status = "active";
    seat.activatedAt = now.toISOString();
    return { org: { ...org }, courses: teamCourses(d, org).map(courseView) };
  });
  if (outcome.problem !== undefined) return { ok: false, problem: outcome.problem };
  const { org, courses } = outcome;
  await enrollInTeamCourses(user.id, courses.map((c) => c.id));
  await notifyMany(managerIdsOf(org).filter((id) => id !== user.id), {
    type: "system",
    subject: `${user.name} joined the ${org.name} team`,
    message: "Their seat is active and they are enrolled in the team's courses.",
    link: teamHref(org),
    fromUserId: user.id,
  });
  return { ok: true, team: { id: org.id, name: org.name }, courses };
}

/** Accept the invitation behind an emailed link. Single use: the seat is bound to the account that accepts it. */
export async function acceptInvite(rawToken: string, user: Pick<User, "id" | "name">, now: Date = new Date()): Promise<AcceptResult> {
  return activateSeat((d) => seatForToken(d, rawToken), user, now);
}

/** Accept an invitation from inside the app: only for the account whose confirmed email was invited. */
export async function acceptInviteForSeat(seatId: string, user: Pick<User, "id" | "name">, now: Date = new Date()): Promise<AcceptResult> {
  return activateSeat(
    (d) => {
      // The address comes from the stored account: the session's copy can be older than a change of email.
      const account = d.users.find((u) => u.id === user.id);
      if (!account?.emailVerifiedAt) return undefined;
      const email = account.email.toLowerCase();
      return d.orgSeats.find((s) => s.id === seatId && s.email.toLowerCase() === email);
    },
    user,
    now,
  );
}

export type ClaimResult = { ok: true; team: { id: string; name: string } } | { ok: false; error: string };

/** A manager takes one of the team's free seats for themselves (no invitation needed). */
export async function claimSeat(orgId: string, user: Pick<User, "id" | "email">, now: Date = new Date()): Promise<ClaimResult> {
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { error: "This team no longer exists." };
    const seats = d.orgSeats.filter((s) => s.orgId === org.id);
    if (seats.some((s) => s.status === "active" && s.userId === user.id)) return { error: JOIN_PROBLEM_MESSAGES.already_member };
    const email = user.email.toLowerCase();
    // An open invitation to their own address becomes the seat; otherwise a free seat is used.
    const invited = seats.find((s) => s.status === "invited" && s.email.toLowerCase() === email);
    if (!invited && seatUsage(org, seats).available < 1) return { error: "Every seat is assigned. Buy more seats or revoke one first." };
    if (invited && seats.filter((s) => s.status === "active").length >= org.seatCount) return { error: JOIN_PROBLEM_MESSAGES.full };
    const stamp = now.toISOString();
    if (invited) {
      invited.userId = user.id;
      invited.status = "active";
      invited.activatedAt = stamp;
    } else {
      d.orgSeats.push({ id: uid("seat"), orgId: org.id, userId: user.id, email, status: "active", assignedAt: stamp, activatedAt: stamp });
    }
    return { org: { ...org }, courseIds: teamCourses(d, org).map((c) => c.id) };
  });
  if (outcome.error !== undefined) return { ok: false, error: outcome.error };
  await enrollInTeamCourses(user.id, outcome.courseIds);
  return { ok: true, team: { id: outcome.org.id, name: outcome.org.name } };
}

/* ------------------------------------------------------------------ */
/* Team settings and administration                                    */
/* ------------------------------------------------------------------ */

export type TeamChange<T = undefined> = { ok: true; org: Organization; data: T } | { ok: false; error: string };

export async function renameTeam(orgId: string, name: string): Promise<TeamChange<{ previous: string }>> {
  return mutate((d): TeamChange<{ previous: string }> => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false, error: "This team no longer exists." };
    const previous = org.name;
    org.name = name;
    return { ok: true, org: { ...org }, data: { previous } };
  });
}

/**
 * Manager and ownership changes need a team with seats (paid, or set up by an
 * administrator): an unpaid draft costs nothing to create, so it must not be
 * a way to probe which addresses have accounts or to notify strangers.
 */
export const DRAFT_TEAM_PEOPLE_ERROR = "You can add managers or hand over the team once its first seats are paid for.";

/** One notification per team, person and day, however often they are added and removed. */
function teamRoleDedupeKey(kind: "manager" | "owner", orgId: string, userId: string): string {
  return `team-${kind}:${orgId}:${userId}:${new Date().toISOString().slice(0, 10)}`;
}

/** Let another member manage the team (by their account email). `asAdmin` also allows it on a team without seats. */
export async function addManager(orgId: string, email: string, actor: Pick<User, "id" | "name">, opts: { asAdmin?: boolean } = {}): Promise<TeamChange<{ user: TeamUserView }>> {
  const result = await mutate((d): TeamChange<{ user: TeamUserView }> => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false, error: "This team no longer exists." };
    if (!opts.asAdmin && isDraft(d, org)) return { ok: false, error: DRAFT_TEAM_PEOPLE_ERROR };
    const user = d.users.find((u) => u.email.toLowerCase() === email && u.enabled);
    if (!user) return { ok: false, error: "No account uses this email address. Ask them to sign up first." };
    if (orgRole(org, user.id)) return { ok: false, error: `${user.name} already manages this team.` };
    if (org.managerIds.length >= MAX_TEAM_MANAGERS) return { ok: false, error: `A team can have at most ${MAX_TEAM_MANAGERS} managers besides its owner.` };
    org.managerIds.push(user.id);
    return { ok: true, org: { ...org }, data: { user: userView(user) as TeamUserView } };
  });
  if (result.ok && result.data.user.id !== actor.id) {
    await notify(result.data.user.id, {
      type: "system",
      subject: `You can now manage the ${result.org.name} team`,
      message: `${actor.name} made you a team manager: invite members, assign seats and follow their progress.`,
      link: teamHref(result.org),
      fromUserId: actor.id,
      dedupeKey: teamRoleDedupeKey("manager", result.org.id, result.data.user.id),
    });
  }
  return result;
}

export async function removeManager(orgId: string, userId: string): Promise<TeamChange> {
  return mutate((d): TeamChange => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false, error: "This team no longer exists." };
    if (!org.managerIds.includes(userId)) return { ok: false, error: "This person is not a manager of the team." };
    org.managerIds = org.managerIds.filter((id) => id !== userId);
    return { ok: true, org: { ...org }, data: undefined };
  });
}

/** Hand the team to another account (by email). The previous owner stays on as a manager. `asAdmin` also allows it on a team without seats. */
export async function transferOwnership(
  orgId: string,
  email: string,
  actor: Pick<User, "id" | "name">,
  opts: { asAdmin?: boolean } = {},
): Promise<TeamChange<{ owner: TeamUserView; previousOwnerId: string }>> {
  const result = await mutate((d): TeamChange<{ owner: TeamUserView; previousOwnerId: string }> => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false, error: "This team no longer exists." };
    if (!opts.asAdmin && isDraft(d, org)) return { ok: false, error: DRAFT_TEAM_PEOPLE_ERROR };
    const user = d.users.find((u) => u.email.toLowerCase() === email && u.enabled);
    if (!user) return { ok: false, error: "No account uses this email address." };
    if (org.ownerId === user.id) return { ok: false, error: `${user.name} already owns this team.` };
    const previousOwnerId = org.ownerId;
    org.managerIds = org.managerIds.filter((id) => id !== user.id);
    if (d.users.some((u) => u.id === previousOwnerId) && !org.managerIds.includes(previousOwnerId)) org.managerIds.push(previousOwnerId);
    org.ownerId = user.id;
    return { ok: true, org: { ...org }, data: { owner: userView(user) as TeamUserView, previousOwnerId } };
  });
  if (result.ok && result.data.owner.id !== actor.id) {
    await notify(result.data.owner.id, {
      type: "system",
      subject: `You now own the ${result.org.name} team`,
      message: "You can invite members, assign seats, add managers and buy more seats.",
      link: teamHref(result.org),
      fromUserId: actor.id,
      dedupeKey: teamRoleDedupeKey("owner", result.org.id, result.data.owner.id),
    });
  }
  return result;
}

/** Set a team's seat count (administrators: invoices, corrections). Never below the seats in use. */
export async function adjustSeats(orgId: string, seatCount: number): Promise<TeamChange<{ previous: number }>> {
  const result = await mutate((d): TeamChange<{ previous: number }> => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false, error: "This team no longer exists." };
    const used = seatUsage(org, d.orgSeats.filter((s) => s.orgId === org.id)).used;
    if (seatCount < used) return { ok: false, error: `${pluralize(used, "seat")} ${used === 1 ? "is" : "are"} in use. Revoke seats first, or keep at least ${used}.` };
    const previous = org.seatCount;
    org.seatCount = seatCount;
    // An administrator looked after this team (e.g. its invoice was paid): never clear it as an abandoned checkout.
    if (org.checkoutDraft) delete org.checkoutDraft;
    return { ok: true, org: { ...org }, data: { previous } };
  });
  if (result.ok && result.data.previous !== result.org.seatCount) {
    const diff = result.org.seatCount - result.data.previous;
    await notifyMany(managerIdsOf(result.org), {
      type: "system",
      subject: diff > 0 ? `${pluralize(diff, "seat")} added to ${result.org.name}` : `${pluralize(-diff, "seat")} removed from ${result.org.name}`,
      message: `The team now has ${pluralize(result.org.seatCount, "seat")}.`,
      link: teamHref(result.org),
    });
  }
  return result;
}

/**
 * Replace the team's courses (administrators). Members are enrolled in the
 * courses that were added; courses that were removed stay with the members
 * who already joined them.
 */
export async function setTeamCourses(orgId: string, courseIds: readonly string[]): Promise<TeamChange<{ added: string[]; removed: string[] }>> {
  const result = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return { ok: false as const, error: "This team no longer exists." };
    const wanted = Array.from(new Set(courseIds)).filter((id) => d.courses.some((c) => c.id === id));
    if (!wanted.length) return { ok: false as const, error: "A team needs at least one course." };
    if (wanted.length > MAX_TEAM_COURSES) return { ok: false as const, error: `Choose at most ${MAX_TEAM_COURSES} courses.` };
    const added = wanted.filter((id) => !org.courseIds.includes(id));
    const removed = org.courseIds.filter((id) => !wanted.includes(id));
    org.courseIds = wanted;
    if (org.checkoutDraft) delete org.checkoutDraft;
    const members = d.orgSeats.filter((s) => s.orgId === org.id && s.status === "active" && s.userId).map((s) => s.userId as string);
    return { ok: true as const, org: { ...org }, data: { added, removed }, members };
  });
  if (!result.ok) return result;
  for (const userId of result.members) await enrollInTeamCourses(userId, result.data.added);
  return { ok: true, org: result.org, data: result.data };
}

/** Create a team without an online order (administrators: invoiced or sponsored teams). */
export async function createTeam(input: { name: string; ownerEmail: string; seatCount: number; courseIds: readonly string[] }): Promise<TeamChange<{ owner: TeamUserView }>> {
  const result = await mutate((d): TeamChange<{ owner: TeamUserView }> => {
    const owner = d.users.find((u) => u.email.toLowerCase() === input.ownerEmail && u.enabled);
    if (!owner) return { ok: false, error: "No account uses the owner's email address. Create the account first." };
    const courseIds = Array.from(new Set(input.courseIds)).filter((id) => d.courses.some((c) => c.id === id));
    if (!courseIds.length) return { ok: false, error: "Choose at least one course." };
    if (courseIds.length > MAX_TEAM_COURSES) return { ok: false, error: `Choose at most ${MAX_TEAM_COURSES} courses.` };
    const org: Organization = {
      id: uid("org"),
      name: input.name,
      slug: uniqueSlug(input.name, d.organizations.map((o) => o.slug)),
      ownerId: owner.id,
      managerIds: [],
      seatCount: input.seatCount,
      courseIds,
      createdAt: new Date().toISOString(),
    };
    d.organizations.push(org);
    return { ok: true, org: { ...org }, data: { owner: userView(owner) as TeamUserView } };
  });
  if (result.ok) {
    await notify(result.data.owner.id, {
      type: "system",
      subject: `Your team ${result.org.name} is ready`,
      message: `${pluralize(result.org.seatCount, "seat")} ${result.org.seatCount === 1 ? "is" : "are"} waiting. Invite your team members to get them started.`,
      link: teamHref(result.org),
    });
  }
  return result;
}

/** Delete a team: every seat is revoked first (members lose the access their seat gave them). */
export async function deleteTeam(orgId: string): Promise<{ ok: true; name: string; revoked: number } | { ok: false; error: string }> {
  const removals: Removal[] = [];
  const outcome = await mutate((d) => {
    const org = d.organizations.find((o) => o.id === orgId);
    if (!org) return null;
    const revoked = d.orgSeats.filter((s) => s.orgId === org.id && s.status !== "revoked").map((s) => revokeSeatIn(d, s, removals));
    d.orgSeats = d.orgSeats.filter((s) => s.orgId !== org.id);
    d.organizations = d.organizations.filter((o) => o.id !== org.id);
    return { org: { ...org }, revoked };
  });
  if (!outcome) return { ok: false, error: "This team no longer exists." };
  await applyRemovals(removals);
  await notifyRevokedMembers(outcome.org, outcome.revoked, "The team was closed. Courses you already finished stay in your account.");
  return { ok: true, name: outcome.org.name, revoked: outcome.revoked.length };
}

/* ------------------------------------------------------------------ */
/* Read models: manager dashboard                                      */
/* ------------------------------------------------------------------ */

export interface TeamOrderView {
  id: string;
  orderId: string;
  seats: number;
  amount: number;
  currency: string;
  status: Payment["status"];
  createdAt: string;
  paidAt?: string;
  invoiceNumber?: string;
  refundedAmount?: number;
  failureReason?: string;
  buyerId: string;
  buyerName: string;
}

export interface TeamOverview {
  org: Organization;
  draft: boolean;
  usage: SeatUsage;
  courses: TeamCourseView[];
  owner: TeamUserView | null;
  managers: TeamUserView[];
  /** What one more seat costs today (null when the team's courses cannot be priced). */
  seatPrice: { amount: number; currency: string } | null;
  /** Invitations whose link has expired (they still hold a seat). */
  expiredInvites: number;
  orders: TeamOrderView[];
}

export async function getTeamOverview(orgRef: string, now: Date = new Date()): Promise<TeamOverview | null> {
  const db = await getDb();
  const org = findTeam(db, orgRef);
  if (!org) return null;
  const seats = db.orgSeats.filter((s) => s.orgId === org.id);
  const users = new Map(db.users.map((u) => [u.id, u]));
  const courses = teamCourses(db, org);
  const quoted = quoteSeats(courses, 1);
  const orders = teamOrders(db, org.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((p): TeamOrderView => ({
      id: p.id,
      orderId: p.orderId,
      seats: seatsOrderOf(p)?.seats ?? 0,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      createdAt: p.createdAt,
      paidAt: p.paidAt,
      invoiceNumber: p.invoiceNumber,
      refundedAmount: p.refundedAmount,
      failureReason: p.failureReason,
      buyerId: p.userId,
      buyerName: users.get(p.userId)?.name ?? p.billingName,
    }));
  return {
    org: { ...org },
    draft: isDraft(db, org),
    usage: seatUsage(org, seats),
    courses: courses.map(courseView),
    owner: userView(users.get(org.ownerId)),
    managers: org.managerIds.map((id) => userView(users.get(id))).filter((u): u is TeamUserView => !!u),
    seatPrice: quoted.ok ? { amount: quoted.quote.unitAmount, currency: quoted.quote.currency } : null,
    expiredInvites: seats.filter((s) => seatState(s, now.getTime()) === "expired").length,
    orders,
  };
}

export interface SeatView {
  id: string;
  /** Address the seat was assigned to. */
  email: string;
  state: SeatState;
  assignedAt: string;
  activatedAt?: string;
  /** When an open invitation stops working. */
  expiresAt?: string;
  user: TeamUserView | null;
  role: "owner" | "manager" | null;
}

/** Seats of a team matching the filter: members first (by name), then invitations (newest first). */
export async function listSeats(orgId: string, filter: Pick<SeatFilter, "status" | "q">, now: Date = new Date()): Promise<SeatView[]> {
  const db = await getDb();
  const org = db.organizations.find((o) => o.id === orgId);
  if (!org) return [];
  const users = new Map(db.users.map((u) => [u.id, u]));
  const q = filter.q.toLowerCase();
  const rank: Record<SeatState, number> = { active: 0, invited: 1, expired: 2, revoked: 3 };
  return db.orgSeats
    .filter((s) => s.orgId === org.id)
    .map((s): SeatView => {
      const user = s.userId ? users.get(s.userId) : undefined;
      return {
        id: s.id,
        email: s.email,
        state: seatState(s, now.getTime()),
        assignedAt: s.assignedAt,
        activatedAt: s.activatedAt,
        expiresAt: s.status === "invited" ? new Date(inviteExpiresAt(s)).toISOString() : undefined,
        user: userView(user),
        role: user ? orgRole(org, user.id) : null,
      };
    })
    .filter((s) => seatMatchesFilter(s.state, filter.status))
    .filter((s) => !q || [s.email, s.user?.name, s.user?.email, s.user?.username].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.state === "active" ? (a.user?.name ?? a.email).localeCompare(b.user?.name ?? b.email) : b.assignedAt.localeCompare(a.assignedAt)));
}

export interface MemberProgressRow {
  seatId: string;
  user: TeamUserView;
  joinedAt?: string;
  /** One entry per listed course, in the same order as `TeamProgress.courses`. */
  courses: MemberCourseProgress[];
  /** Mean progress over the listed courses. */
  average: number;
  completed: number;
  lastActivityAt?: string;
}

export interface TeamProgress {
  /** Courses shown as columns (the whole team's courses, or the one selected). */
  courses: TeamCourseView[];
  rows: MemberProgressRow[];
  summary: {
    members: number;
    /** Mean progress over every member and course. */
    average: number;
    completions: number;
    /** Members who have not started any course. */
    notStarted: number;
    /** Members active in the last 7 days. */
    activeThisWeek: number;
  };
  perCourse: { courseId: string; average: number; completed: number; started: number }[];
}

/**
 * Progress of every active member in the team's courses. `filter.courseId`
 * narrows the columns to one course; `filter.state` keeps members who are in
 * that state in at least one listed course. The summary always covers the
 * whole team.
 */
export async function getTeamProgress(orgId: string, filter: Pick<ProgressFilter, "courseId" | "state" | "q"> = { courseId: "", state: "all", q: "" }, now: Date = new Date()): Promise<TeamProgress | null> {
  const db = await getDb();
  const org = db.organizations.find((o) => o.id === orgId);
  if (!org) return null;
  const courses = teamCourses(db, org);
  const courseIds = new Set(courses.map((c) => c.id));
  const members = db.orgSeats.filter((s) => s.orgId === org.id && s.status === "active" && s.userId);
  const memberIds = new Set(members.map((s) => s.userId as string));
  const users = new Map(db.users.map((u) => [u.id, u]));
  const key = (userId: string, courseId: string) => `${userId}\u0000${courseId}`;

  const lessonsTotal = new Map<string, number>();
  for (const lesson of db.lessons) if (courseIds.has(lesson.courseId)) lessonsTotal.set(lesson.courseId, (lessonsTotal.get(lesson.courseId) ?? 0) + 1);

  const activity = new Map<string, { done: number; seconds: number; last?: string }>();
  for (const p of db.progress) {
    if (!memberIds.has(p.userId) || !courseIds.has(p.courseId)) continue;
    const k = key(p.userId, p.courseId);
    const entry = activity.get(k) ?? { done: 0, seconds: 0 };
    if (p.status === "complete") entry.done++;
    entry.seconds += p.dwellSeconds;
    if (!entry.last || p.updatedAt > entry.last) entry.last = p.updatedAt;
    activity.set(k, entry);
  }
  const enrollments = new Map<string, Database["enrollments"][number]>();
  for (const e of db.enrollments) if (memberIds.has(e.userId) && courseIds.has(e.courseId)) enrollments.set(key(e.userId, e.courseId), e);
  const certificates = new Map<string, string>();
  for (const c of db.certificates) if (c.courseId && c.published && memberIds.has(c.userId) && courseIds.has(c.courseId)) certificates.set(key(c.userId, c.courseId), c.code);

  const all: MemberProgressRow[] = [];
  for (const seat of members) {
    const user = userView(users.get(seat.userId as string));
    if (!user) continue;
    const rows = courses.map((course): MemberCourseProgress => {
      const k = key(user.id, course.id);
      const enrollment = enrollments.get(k);
      const act = activity.get(k);
      const progress = enrollment ? Math.min(100, Math.max(0, Math.round(enrollment.progress))) : 0;
      return {
        courseId: course.id,
        enrolled: !!enrollment,
        progress,
        state: progressState(progress, enrollment?.completedAt),
        lessonsDone: act?.done ?? 0,
        lessonsTotal: lessonsTotal.get(course.id) ?? 0,
        timeSpentSeconds: act?.seconds ?? 0,
        lastActivityAt: act?.last,
        completedAt: enrollment?.completedAt,
        certificateCode: certificates.get(k),
      };
    });
    const last = rows.map((r) => r.lastActivityAt).filter((v): v is string => !!v).sort().pop();
    all.push({ seatId: seat.id, user, joinedAt: seat.activatedAt, courses: rows, average: averageProgress(rows), completed: rows.filter((r) => r.state === "completed").length, lastActivityAt: last });
  }

  const weekAgo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
  const cells = all.flatMap((r) => r.courses);
  const summary = {
    members: all.length,
    average: averageProgress(cells),
    completions: cells.filter((c) => c.state === "completed").length,
    notStarted: all.filter((r) => r.courses.every((c) => c.state === "not_started")).length,
    activeThisWeek: all.filter((r) => !!r.lastActivityAt && r.lastActivityAt >= weekAgo).length,
  };
  const perCourse = courses.map((course, i) => {
    const column = all.map((r) => r.courses[i]);
    return { courseId: course.id, average: averageProgress(column), completed: column.filter((c) => c.state === "completed").length, started: column.filter((c) => c.state !== "not_started").length };
  });

  const shown = filter.courseId && courseIds.has(filter.courseId) ? courses.filter((c) => c.id === filter.courseId) : courses;
  const shownIds = new Set(shown.map((c) => c.id));
  const q = filter.q.toLowerCase();
  const rows = all
    .map((r) => {
      const listed = r.courses.filter((c) => shownIds.has(c.courseId));
      return { ...r, courses: listed, average: averageProgress(listed), completed: listed.filter((c) => c.state === "completed").length };
    })
    .filter((r) => filter.state === "all" || r.courses.some((c) => c.state === filter.state))
    .filter((r) => !q || [r.user.name, r.user.email, r.user.username].some((v) => v.toLowerCase().includes(q)))
    .sort((a, b) => a.user.name.localeCompare(b.user.name));
  return { courses: shown.map(courseView), rows, summary, perCourse };
}

const day = (iso: string | undefined) => iso?.slice(0, 10) ?? "";

/** Team progress as CSV: one row per member and course. */
export function teamProgressToCsv(progress: Pick<TeamProgress, "courses" | "rows">): string {
  const titles = new Map(progress.courses.map((c) => [c.id, c.title]));
  const header = ["Member", "Email", "Joined team", "Course", "Status", "Progress %", "Lessons completed", "Lessons total", "Time spent (minutes)", "Last activity", "Completed on", "Certificate"];
  const lines: string[][] = [header];
  for (const row of progress.rows) {
    for (const c of row.courses) {
      lines.push([
        row.user.name,
        row.user.email,
        day(row.joinedAt),
        titles.get(c.courseId) ?? "",
        c.enrolled ? PROGRESS_STATE_LABELS[c.state] : "Not enrolled",
        String(c.progress),
        String(c.lessonsDone),
        String(c.lessonsTotal),
        String(Math.round(c.timeSpentSeconds / 60)),
        day(c.lastActivityAt),
        day(c.completedAt),
        c.certificateCode ?? "",
      ]);
    }
  }
  return toCsv(lines);
}

/** Seat assignments as CSV (members and invitations). */
export function seatsToCsv(seats: readonly SeatView[]): string {
  const header = ["Name", "Account email", "Invited address", "Status", "Role", "Assigned on", "Joined on", "Invitation expires"];
  return toCsv([
    header,
    ...seats.map((s) => [s.user?.name ?? "", s.user?.email ?? "", s.email, SEAT_STATE_LABELS[s.state], s.role === "owner" ? "Owner" : s.role === "manager" ? "Manager" : "Member", day(s.assignedAt), day(s.activatedAt), s.state === "invited" ? day(s.expiresAt) : ""]),
  ]);
}

export interface TeamMembership {
  seatId: string;
  team: { id: string; name: string };
  joinedAt?: string;
  courses: (TeamCourseView & { progress: number; completed: boolean })[];
}

/** Teams a member holds a seat in, with their own progress (shown on `/team` to members). */
export async function getMemberships(userId: string): Promise<TeamMembership[]> {
  const db = await getDb();
  const out: TeamMembership[] = [];
  for (const seat of db.orgSeats) {
    if (seat.userId !== userId || seat.status !== "active") continue;
    const org = db.organizations.find((o) => o.id === seat.orgId);
    if (!org) continue;
    out.push({
      seatId: seat.id,
      team: { id: org.id, name: org.name },
      joinedAt: seat.activatedAt,
      courses: teamCourses(db, org).map((course) => {
        const enrollment = db.enrollments.find((e) => e.userId === userId && e.courseId === course.id);
        return { ...courseView(course), progress: Math.round(enrollment?.progress ?? 0), completed: !!enrollment?.completedAt };
      }),
    });
  }
  return out.sort((a, b) => a.team.name.localeCompare(b.team.name));
}

/* ------------------------------------------------------------------ */
/* Read models: administrators                                         */
/* ------------------------------------------------------------------ */

export interface AdminTeamRow {
  org: Organization;
  owner: TeamUserView | null;
  usage: SeatUsage;
  draft: boolean;
  /** Paid seats orders per currency. */
  paid: { currency: string; amount: number }[];
  /** An order is waiting for payment or confirmation. */
  openOrders: number;
}

export interface TeamsSummary {
  teams: number;
  /** Started at /team/buy, not paid for yet. */
  pending: number;
  seats: number;
  active: number;
  invited: number;
  revenue: { currency: string; amount: number }[];
}

function adminRow(db: Database, org: Organization, users: Map<string, User>): AdminTeamRow {
  const orders = teamOrders(db, org.id);
  return {
    org: { ...org },
    owner: userView(users.get(org.ownerId)),
    usage: seatUsage(org, db.orgSeats.filter((s) => s.orgId === org.id)),
    draft: isDraft(db, org),
    paid: sumByCurrency(orders.filter((p) => p.status === "paid").map((p) => ({ currency: p.currency, amount: p.amount - (p.refundedAmount ?? 0) }))),
    openOrders: orders.filter((p) => p.status === "pending").length,
  };
}

/** Every team matching the filter: paid teams first (newest first), unpaid drafts last. */
export async function listTeams(filter: Pick<TeamFilter, "status" | "q">): Promise<AdminTeamRow[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const q = filter.q.toLowerCase();
  return db.organizations
    .map((org) => adminRow(db, org, users))
    .filter((r) => {
      if (filter.status === "active") return !r.draft && r.usage.total > 0;
      if (filter.status === "pending") return r.draft;
      if (filter.status === "full") return r.usage.total > 0 && r.usage.available === 0;
      return true;
    })
    .filter((r) => !q || [r.org.name, r.org.slug, r.owner?.name, r.owner?.email].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => Number(a.draft) - Number(b.draft) || b.org.createdAt.localeCompare(a.org.createdAt));
}

export async function getTeamsSummary(): Promise<TeamsSummary> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u]));
  const rows = db.organizations.map((org) => adminRow(db, org, users));
  const live = rows.filter((r) => !r.draft);
  return {
    teams: live.length,
    pending: rows.length - live.length,
    seats: live.reduce((n, r) => n + r.usage.total, 0),
    active: live.reduce((n, r) => n + r.usage.active, 0),
    invited: live.reduce((n, r) => n + r.usage.invited, 0),
    revenue: sumByCurrency(rows.flatMap((r) => r.paid)),
  };
}

/** Every course, for the administrators' course picker (unpublished ones included). */
export async function listTeamCourseOptions(): Promise<TeamCourseView[]> {
  const db = await getDb();
  return [...db.courses].sort((a, b) => a.title.localeCompare(b.title)).map(courseView);
}

const HISTORY_LABELS: Record<string, string> = {
  "team.create": "Team created",
  "team.delete": "Team deleted",
  "team.rename": "Team renamed",
  "team.invite": "Members invited",
  "team.invite_resend": "Invitations sent again",
  "team.seat_revoke": "Seats revoked",
  "team.seat_reassign": "Seat reassigned",
  "team.seats_purchase": "Seats bought",
  "team.seats_refund": "Seats removed after a refund",
  "team.seats_adjust": "Seat count changed",
  "team.courses_update": "Courses changed",
  "team.manager_add": "Manager added",
  "team.manager_remove": "Manager removed",
  "team.owner_transfer": "Ownership transferred",
  "team.invoice_request": "Invoice requested",
  "team.export": "Data exported",
};

export interface TeamHistoryEntry {
  id: string;
  label: string;
  /** Short facts from the event ("12 → 20 seats", "5 sent"). */
  detail: string;
  actorName: string;
  createdAt: string;
}

function historyDetail(action: string, meta: Record<string, string | number | boolean | null>): string {
  const n = (key: string) => (typeof meta[key] === "number" ? (meta[key] as number) : null);
  const t = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : "");
  switch (action) {
    case "team.seats_adjust":
      return [`${n("previous") ?? "?"} → ${n("seatCount") ?? "?"} seats`, t("note")].filter(Boolean).join(" · ");
    case "team.seats_purchase":
      return [`+${n("seats") ?? 0} seats`, t("orderId")].filter(Boolean).join(" · ");
    case "team.seats_refund":
      return [`−${n("removed") ?? 0} seats`, n("revoked") ? `${n("revoked")} revoked` : "", t("orderId")].filter(Boolean).join(" · ");
    case "team.invite":
      return [`${n("sent") ?? 0} sent`, n("skipped") ? `${n("skipped")} skipped` : ""].filter(Boolean).join(" · ");
    case "team.invite_resend":
      return `${n("sent") ?? 0} sent`;
    case "team.seat_revoke":
      return `${pluralize(n("revoked") ?? 0, "seat")}${n("members") ? `, ${n("members")} in use by a member` : ""}`;
    case "team.courses_update":
      return [n("added") ? `${n("added")} added` : "", n("removed") ? `${n("removed")} removed` : ""].filter(Boolean).join(" · ");
    case "team.rename":
      return t("previous") && t("name") ? `${t("previous")} → ${t("name")}` : "";
    case "team.invoice_request":
      return `${pluralize(n("seats") ?? 0, "seat")}${n("amount") !== null && t("currency") ? ` · ${formatPrice(n("amount") as number, t("currency"))}` : ""}`;
    case "team.create":
      return pluralize(n("seatCount") ?? 0, "seat");
    case "team.export":
      return [t("export"), n("rows") !== null ? `${n("rows")} rows` : ""].filter(Boolean).join(" · ");
    default:
      return "";
  }
}

/** Latest audit entries about a team (seat changes, invitations, managers), newest first. */
export async function getTeamHistory(orgId: string, limit = 12): Promise<TeamHistoryEntry[]> {
  const db = await getDb();
  const users = new Map(db.users.map((u) => [u.id, u.name]));
  return db.auditEvents
    .filter((e) => e.targetType === "team" && e.targetId === orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      label: HISTORY_LABELS[e.action] ?? e.action,
      detail: historyDetail(e.action, e.meta ?? {}),
      actorName: e.actorId ? (users.get(e.actorId) ?? "Deleted member") : "System",
      createdAt: e.createdAt,
    }));
}

export function teamsToCsv(rows: readonly AdminTeamRow[]): string {
  const header = ["Team", "Owner", "Owner email", "Status", "Seats", "Active members", "Open invitations", "Free seats", "Courses", "Currency", "Paid", "Created"];
  const lines: string[][] = [header];
  for (const r of rows) {
    const paid = r.paid.length ? r.paid : [{ currency: "", amount: 0 }];
    for (const p of paid) {
      lines.push([
        r.org.name,
        r.owner?.name ?? "",
        r.owner?.email ?? "",
        r.draft ? "Awaiting payment" : "Active",
        String(r.usage.total),
        String(r.usage.active),
        String(r.usage.invited),
        String(r.usage.available),
        String(r.org.courseIds.length),
        p.currency,
        (p.amount / 100).toFixed(2),
        day(r.org.createdAt),
      ]);
    }
  }
  return toCsv(lines);
}
