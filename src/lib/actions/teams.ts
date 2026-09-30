"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Organization, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getRequestInfo } from "@/lib/auth/request-info";
import { SlidingWindowRateLimiter } from "@/lib/auth/rate-limit";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, isValidEmail, pluralize } from "@/lib/utils";
import { plural } from "@/components/catalog/format";
import { cleanIdList } from "@/lib/growth/affiliates-shared";
import {
  MAX_TEAM_COURSES,
  MAX_TEAM_SEATS,
  TEAM_NAME_MAX,
  TEAM_NAME_MIN,
  inviteSummary,
  normalizeTeamName,
  orgRole,
  parseInviteList,
  parseSeatCount,
  seatsOrderRef,
} from "@/lib/growth/teams-shared";
import {
  JOIN_PROBLEM_MESSAGES,
  acceptInvite,
  acceptInviteForSeat,
  addManager,
  adjustSeats,
  claimSeat,
  createTeam,
  deleteTeam,
  inviteMembers,
  reassignSeat,
  removeManager,
  renameTeam,
  requestTeamInvoice,
  resendInvites,
  resolveSeatsOrder,
  revokeSeats,
  seatsPurchaseProblem,
  setTeamCourses,
  startTeamPurchase,
  transferOwnership,
  type AcceptResult,
} from "@/lib/growth/teams";
import { joinAttemptAllowed, seatsCheckoutPath, seatsCheckoutReady } from "@/lib/growth/team-checkout";

/**
 * Team (B2B seats) actions (growth area): buying seats at /team/buy,
 * managing seats and managers at /team, accepting invitations at
 * /join/<token>, and administration at /admin/teams. Every action re-checks
 * the caller's role in the team.
 */

const MAX_BULK = 200;
const MAX_INVITE_TEXT = 100_000;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const HOUR_MS = 60 * 60 * 1000;

const g = globalThis as unknown as { __llTeamActionLimiter?: SlidingWindowRateLimiter };
const limiter: SlidingWindowRateLimiter = (g.__llTeamActionLimiter ??= new SlidingWindowRateLimiter({ maxKeys: 20_000 }));

type Level = "manage" | "own" | "admin";
type Access = { user: User; org: Organization; role: "owner" | "manager" | "admin" };

/** The caller's standing in a team. Administrators can do everything; "own" needs the owner. */
async function teamAccess(orgId: unknown, level: Level): Promise<Access | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to manage your team." };
  const db = await getDb();
  const org = typeof orgId === "string" && ID.test(orgId) ? db.organizations.find((o) => o.id === orgId) : undefined;
  const role = isAdmin(user) ? "admin" : org ? orgRole(org, user.id) : null;
  if (level === "admin" && role !== "admin") return { error: "Only administrators can do that." };
  // The same answer for a missing team and one the caller does not manage.
  if (!org || !role) return { error: "This team does not exist, or you don't manage it." };
  if (level === "own" && role === "manager") return { error: "Only the team owner can do that." };
  return { user, org: { ...org }, role };
}

function revalidateTeam(orgId?: string) {
  revalidatePath("/team");
  revalidatePath("/admin/teams");
  if (orgId) revalidatePath(`/admin/teams/${orgId}`);
}

function teamPath(org: Pick<Organization, "slug">): string {
  return `/team?org=${encodeURIComponent(org.slug)}`;
}

function courseIdsFrom(formData: FormData): string[] {
  return formData
    .getAll("courseIds")
    .filter((v): v is string => typeof v === "string" && ID.test(v))
    .slice(0, MAX_TEAM_COURSES + 1);
}

/* ------------------------------------------------------------------ */
/* Buying seats                                                        */
/* ------------------------------------------------------------------ */

/** Continue a priced seats order: to the checkout, or to the administrators as an invoice request. */
async function continuePurchase(user: User, ref: string, mode: string): Promise<ActionResult> {
  const db = await getDb();
  const resolved = resolveSeatsOrder(db, ref);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const problem = seatsPurchaseProblem(db, user, resolved.order);
  if (problem) return { ok: false, error: problem };
  if (mode === "invoice" || !seatsCheckoutReady()) {
    await requestTeamInvoice(user, resolved.order);
    // A first team adds "My team" to the buyer's sidebar.
    revalidatePath("/", "layout");
    await setFlash("Thanks! We'll send you an invoice. Your seats are added as soon as it is paid.", "success");
    redirect(teamPath(resolved.order.org));
  }
  redirect(seatsCheckoutPath(resolved.order.ref));
}

/** /team/buy for a new team: company name, seats and courses, then on to payment. */
export async function startTeamPurchaseAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Sign in to buy seats for your team.", "info");
    redirect(`/login?next=${encodeURIComponent("/team/buy")}`);
  }
  const name = normalizeTeamName(fd(formData, "name"));
  const seats = parseSeatCount(fd(formData, "seats"));
  const courseIds = courseIdsFrom(formData);
  const errors: Record<string, string> = {};
  if (!name) errors.name = `Enter your company or team name (${TEAM_NAME_MIN}–${TEAM_NAME_MAX} characters).`;
  if (!seats) errors.seats = "Enter how many seats you need.";
  if (!courseIds.length) errors.courseIds = "Choose at least one course for your team.";
  if (Object.keys(errors).length || !name || !seats) return { ok: false, error: Object.values(errors)[0] ?? "Check the highlighted fields.", fieldErrors: errors };
  if (!limiter.hit(`buy:${user.id}`, { limit: 20, windowMs: HOUR_MS }).ok) return { ok: false, error: "Too many attempts. Please try again in a little while." };

  const started = await startTeamPurchase(user, { name, courseIds, seats });
  if (!started.ok) return { ok: false, error: started.error, fieldErrors: started.field ? { [started.field]: started.error } : undefined };
  return continuePurchase(user, started.ref, fd(formData, "mode"));
}

/** /team/buy for an existing team: more seats for the same courses (also finishes an unpaid draft). */
export async function buyMoreSeatsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const seats = parseSeatCount(fd(formData, "seats"));
  if (!seats) return { ok: false, error: "Enter how many seats you need.", fieldErrors: { seats: "Enter how many seats you need." } };
  if (!limiter.hit(`buy:${access.user.id}`, { limit: 20, windowMs: HOUR_MS }).ok) return { ok: false, error: "Too many attempts. Please try again in a little while." };
  return continuePurchase(access.user, seatsOrderRef(access.org.id, seats), fd(formData, "mode"));
}

/* ------------------------------------------------------------------ */
/* Seats and invitations                                               */
/* ------------------------------------------------------------------ */

export async function inviteMembersAction(_prev: ActionResult<{ sent: number }> | null, formData: FormData): Promise<ActionResult<{ sent: number }>> {
  const access = await teamAccess(fd(formData, "orgId"), "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const text = fd(formData, "emails");
  if (text.length > MAX_INVITE_TEXT) return { ok: false, error: "This list is too long. Invite up to 200 people at a time." };
  const parsed = parseInviteList(text);
  if (!parsed.entries.length) {
    const error = parsed.invalid.length ? "None of these look like email addresses. Enter one address per line." : "Enter at least one email address.";
    return { ok: false, error, fieldErrors: { emails: error } };
  }
  const result = await inviteMembers(access.org.id, access.user, parsed.entries);
  if (!result.ok) return { ok: false, error: result.error };

  const notes = [inviteSummary(result.sent, result.skipped)];
  if (parsed.invalid.length) notes.push(`${pluralize(parsed.invalid.length, "row")} had no valid email address.`);
  if (parsed.truncated) notes.push("Only the first 200 addresses were used.");
  const message = notes.join(" ");
  if (result.sent === 0) return { ok: false, error: message };
  await audit(access.user, "team.invite", { type: "team", id: access.org.id }, { sent: result.sent, skipped: result.skipped.length });
  revalidateTeam(access.org.id);
  return { ok: true, data: { sent: result.sent }, message };
}

export async function resendInvitesAction(orgId: string, seatIds: string[]): Promise<ActionResult<{ sent: number }>> {
  const access = await teamAccess(orgId, "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const ids = cleanIdList(seatIds, MAX_BULK);
  if (!ids) return { ok: false, error: `Select between 1 and ${MAX_BULK} invitations.` };
  if (!limiter.hit(`resend:${access.org.id}`, { limit: 30, windowMs: HOUR_MS }).ok) return { ok: false, error: "You re-sent invitations many times this hour. Please try again later." };
  const { sent, tooSoon } = await resendInvites(access.org.id, ids, access.user);
  if (!sent) return { ok: false, error: tooSoon ? "These invitations were sent a moment ago. Wait a minute before sending them again." : "Only open invitations can be sent again." };
  await audit(access.user, "team.invite_resend", { type: "team", id: access.org.id }, { sent });
  revalidateTeam(access.org.id);
  return { ok: true, data: { sent }, message: `${pluralize(sent, "invitation")} sent again. Earlier links no longer work.` };
}

export async function revokeSeatsAction(orgId: string, seatIds: string[]): Promise<ActionResult<{ revoked: number }>> {
  const access = await teamAccess(orgId, "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const ids = cleanIdList(seatIds, MAX_BULK);
  if (!ids) return { ok: false, error: `Select between 1 and ${MAX_BULK} seats.` };
  const { revoked, members } = await revokeSeats(access.org.id, ids);
  if (!revoked) return { ok: false, error: "These seats were already revoked." };
  await audit(access.user, "team.seat_revoke", { type: "team", id: access.org.id }, { revoked, members });
  revalidateTeam(access.org.id);
  return { ok: true, data: { revoked }, message: `${pluralize(revoked, "seat")} freed up` };
}

export async function reassignSeatAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const seatId = fd(formData, "seatId");
  const email = fd(formData, "email").toLowerCase();
  if (!ID.test(seatId)) return { ok: false, error: "This seat is no longer assigned." };
  if (email.length > 200 || !isValidEmail(email)) return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: "Enter a valid email address." } };
  const result = await reassignSeat(access.org.id, seatId, { email }, access.user);
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { email: result.error } };
  await audit(access.user, "team.seat_reassign", { type: "team", id: access.org.id }, { seatId });
  revalidateTeam(access.org.id);
  return { ok: true, data: undefined, message: `Seat moved from ${result.from} to ${result.to}. We emailed them an invitation.` };
}

/** A manager takes a free seat for themselves. */
export async function claimSeatAction(orgId: string): Promise<ActionResult> {
  const access = await teamAccess(orgId, "manage");
  if ("error" in access) return { ok: false, error: access.error };
  const result = await claimSeat(access.org.id, access.user);
  if (!result.ok) return { ok: false, error: result.error };
  revalidateTeam(access.org.id);
  revalidatePath("/dashboard");
  return { ok: true, data: undefined, message: "You took a seat and are enrolled in the team's courses." };
}

/** Where a new member lands: the course when the team has one, otherwise their team page. */
async function finishJoin(result: Extract<AcceptResult, { ok: true }>): Promise<never> {
  revalidatePath("/", "layout");
  await setFlash(`Welcome to the ${result.team.name} team! You're enrolled in ${result.courses.length === 1 ? result.courses[0].title : `${result.courses.length} courses`}.`, "success");
  redirect(result.courses.length === 1 ? `/courses/${result.courses[0].slug}` : "/team");
}

/** Accept the invitation behind an emailed link (`/join/<token>`). */
export async function acceptInviteAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const token = fd(formData, "token");
  const user = await getCurrentUser();
  if (!user) {
    await setFlash("Sign in to accept your invitation.", "info");
    redirect(`/login?next=${encodeURIComponent(ID.test(token) ? `/join/${token}` : "/team")}`);
  }
  const { ip } = await getRequestInfo();
  if (!joinAttemptAllowed(ip)) return { ok: false, error: "Too many attempts. Please wait a few minutes and try again." };
  const result = await acceptInvite(token, user);
  if (!result.ok) return { ok: false, error: JOIN_PROBLEM_MESSAGES[result.problem] };
  return finishJoin(result);
}

/** Accept an invitation listed on /team (addressed to the member's confirmed email). */
export async function acceptSeatInviteAction(seatId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in to accept your invitation." };
  if (typeof seatId !== "string" || !ID.test(seatId)) return { ok: false, error: JOIN_PROBLEM_MESSAGES.invalid };
  const result = await acceptInviteForSeat(seatId, user);
  if (!result.ok) return { ok: false, error: JOIN_PROBLEM_MESSAGES[result.problem] };
  return finishJoin(result);
}

/* ------------------------------------------------------------------ */
/* Team settings                                                       */
/* ------------------------------------------------------------------ */

export async function renameTeamAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "own");
  if ("error" in access) return { ok: false, error: access.error };
  const name = normalizeTeamName(fd(formData, "name"));
  if (!name) {
    const error = `Enter a name of ${TEAM_NAME_MIN}–${TEAM_NAME_MAX} characters.`;
    return { ok: false, error, fieldErrors: { name: error } };
  }
  const result = await renameTeam(access.org.id, name);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.data.previous !== name) await audit(access.user, "team.rename", { type: "team", id: access.org.id }, { name, previous: result.data.previous });
  revalidateTeam(access.org.id);
  return { ok: true, data: undefined, message: "Team name saved" };
}

export async function addManagerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "own");
  if ("error" in access) return { ok: false, error: access.error };
  const email = fd(formData, "email").toLowerCase();
  if (email.length > 200 || !isValidEmail(email)) return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: "Enter a valid email address." } };
  const result = await addManager(access.org.id, email, access.user);
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { email: result.error } };
  await audit(access.user, "team.manager_add", { type: "team", id: access.org.id }, { userId: result.data.user.id });
  revalidateTeam(access.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: `${result.data.user.name} can now manage this team` };
}

/** The owner (or an administrator) removes a manager; a manager may also step down themselves. */
export async function removeManagerAction(orgId: string, userId: string): Promise<ActionResult> {
  const access = await teamAccess(orgId, "manage");
  if ("error" in access) return { ok: false, error: access.error };
  if (typeof userId !== "string" || !ID.test(userId)) return { ok: false, error: "This person is not a manager of the team." };
  if (access.role === "manager" && userId !== access.user.id) return { ok: false, error: "Only the team owner can remove other managers." };
  const result = await removeManager(access.org.id, userId);
  if (!result.ok) return { ok: false, error: result.error };
  await audit(access.user, "team.manager_remove", { type: "team", id: access.org.id }, { userId });
  revalidateTeam(access.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: userId === access.user.id ? "You no longer manage this team" : "Manager removed" };
}

export async function transferOwnershipAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "own");
  if ("error" in access) return { ok: false, error: access.error };
  const email = fd(formData, "email").toLowerCase();
  if (email.length > 200 || !isValidEmail(email)) return { ok: false, error: "Enter a valid email address.", fieldErrors: { email: "Enter a valid email address." } };
  const result = await transferOwnership(access.org.id, email, access.user);
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { email: result.error } };
  await audit(access.user, "team.owner_transfer", { type: "team", id: access.org.id }, { ownerId: result.data.owner.id, previousOwnerId: result.data.previousOwnerId });
  revalidateTeam(access.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: `${result.data.owner.name} now owns this team` };
}

/* ------------------------------------------------------------------ */
/* Administrators                                                      */
/* ------------------------------------------------------------------ */

function parseTeamSeats(raw: string): number | null {
  return raw === "0" ? 0 : parseSeatCount(raw, MAX_TEAM_SEATS);
}

export async function adjustSeatsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "admin");
  if ("error" in access) return { ok: false, error: access.error };
  const seatCount = parseTeamSeats(fd(formData, "seatCount"));
  const note = fd(formData, "note").slice(0, 200);
  if (seatCount === null) {
    const error = `Enter a whole number between 0 and ${MAX_TEAM_SEATS}.`;
    return { ok: false, error, fieldErrors: { seatCount: error } };
  }
  const result = await adjustSeats(access.org.id, seatCount);
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { seatCount: result.error } };
  if (result.data.previous !== seatCount) {
    await audit(access.user, "team.seats_adjust", { type: "team", id: access.org.id }, { seatCount, previous: result.data.previous, ...(note ? { note } : {}) });
  }
  revalidateTeam(access.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: result.data.previous === seatCount ? "Seat count unchanged" : `Seat count set to ${seatCount}` };
}

export async function setTeamCoursesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const access = await teamAccess(fd(formData, "orgId"), "admin");
  if ("error" in access) return { ok: false, error: access.error };
  const result = await setTeamCourses(access.org.id, courseIdsFrom(formData));
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { courseIds: result.error } };
  const { added, removed } = result.data;
  if (added.length || removed.length) await audit(access.user, "team.courses_update", { type: "team", id: access.org.id }, { added: added.length, removed: removed.length });
  revalidateTeam(access.org.id);
  return { ok: true, data: undefined, message: added.length ? `Courses saved. Members were enrolled in ${added.length} new ${plural(added.length, "course")}.` : "Courses saved" };
}

export async function createTeamAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const admin = await getCurrentUser();
  if (!admin || !isAdmin(admin)) return { ok: false, error: "Only administrators can create teams." };
  const name = normalizeTeamName(fd(formData, "name"));
  const ownerEmail = fd(formData, "ownerEmail").toLowerCase();
  const seatCount = parseTeamSeats(fd(formData, "seatCount"));
  const courseIds = courseIdsFrom(formData);
  const errors: Record<string, string> = {};
  if (!name) errors.name = `Enter a name of ${TEAM_NAME_MIN}–${TEAM_NAME_MAX} characters.`;
  if (ownerEmail.length > 200 || !isValidEmail(ownerEmail)) errors.ownerEmail = "Enter the owner's account email.";
  if (seatCount === null) errors.seatCount = `Enter a whole number between 0 and ${MAX_TEAM_SEATS}.`;
  if (!courseIds.length) errors.courseIds = "Choose at least one course.";
  if (Object.keys(errors).length || !name || seatCount === null) return { ok: false, error: Object.values(errors)[0] ?? "Check the highlighted fields.", fieldErrors: errors };

  const result = await createTeam({ name, ownerEmail, seatCount, courseIds });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: /owner/i.test(result.error) ? { ownerEmail: result.error } : undefined };
  await audit(admin, "team.create", { type: "team", id: result.org.id }, { name, seatCount, ownerId: result.data.owner.id, courses: result.org.courseIds.length });
  revalidateTeam(result.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { id: result.org.id }, message: `Team ${name} created` };
}

export async function deleteTeamAction(orgId: string): Promise<ActionResult> {
  const access = await teamAccess(orgId, "admin");
  if ("error" in access) return { ok: false, error: access.error };
  const result = await deleteTeam(access.org.id);
  if (!result.ok) return { ok: false, error: result.error };
  await audit(access.user, "team.delete", { type: "team", id: access.org.id }, { name: result.name, revoked: result.revoked });
  revalidateTeam();
  revalidatePath("/", "layout");
  await setFlash(`Team ${result.name} deleted`, "success");
  redirect("/admin/teams");
}

export async function saveTeamSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await getCurrentUser();
  if (!admin || !isAdmin(admin)) return { ok: false, error: "Only administrators can change site settings." };
  if (formData.get("section") !== "teams") return { ok: false, error: "This form is out of date. Reload the page and try again." };
  const teamsEnabled = fdBool(formData, "teamsEnabled");
  await mutate((d) => {
    d.settings.growth = { ...d.settings.growth, teamsEnabled };
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(admin, "settings.update", { type: "settings", id: "growth.teams" }, { teamsEnabled });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: teamsEnabled ? "Team purchases are on" : "Team purchases are off. Existing teams keep working." };
}
