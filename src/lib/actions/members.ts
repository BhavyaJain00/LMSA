"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Database, Role, User } from "@/lib/types";
import { destroyAllSessions, getCurrentUser, isAdmin, isModerator } from "@/lib/auth/session";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { getDb, mutate } from "@/lib/db/store";
import { isRole } from "@/components/admin/settings/roles";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, isValidEmail, slugify, uid } from "@/lib/utils";

/**
 * Member management (Frappe: Settings → Users + /settings/users/:member).
 * Moderators add members and change roles; only admins can grant the admin
 * role, enable/disable accounts, reset passwords or delete members.
 */

type Errors = Record<string, string>;

function fail<T = undefined>(errors: Errors): ActionResult<T> {
  return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
}

function revalidateMember(id?: string, username?: string) {
  revalidatePath("/admin/members");
  if (id) revalidatePath(`/admin/members/${id}`);
  if (username) revalidatePath(`/user/${username}`);
}

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,38}[a-z0-9])?$/;

function readRoles(formData: FormData): Role[] {
  const out: Role[] = [];
  for (const v of formData.getAll("roles")) if (typeof v === "string" && isRole(v) && !out.includes(v)) out.push(v);
  return out;
}

function otherEnabledAdmins(db: Database, excludeId: string): number {
  return db.users.filter((u) => u.id !== excludeId && u.enabled && u.roles.includes("admin")).length;
}

/** Add a member with a password and roles. */
export async function createMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const db = await getDb();

  const name = fd(formData, "name");
  const email = fd(formData, "email").toLowerCase();
  const rawUsername = fd(formData, "username").toLowerCase();
  const password = fd(formData, "password");
  let roles = readRoles(formData);

  const errors: Errors = {};
  if (!email) errors.email = "Email is required";
  else if (!isValidEmail(email)) errors.email = "Please enter a valid email address.";
  else if (db.users.some((u) => u.email.toLowerCase() === email)) errors.email = "A member with this email already exists.";
  if (!name) errors.name = "Full name is required";
  else if (name.length < 2 || name.length > 100) errors.name = "Please enter the member's full name.";
  if (rawUsername) {
    if (!USERNAME_RE.test(rawUsername)) errors.username = "Use 3–40 lowercase letters, numbers, dashes or underscores.";
    else if (db.users.some((u) => u.username.toLowerCase() === rawUsername)) errors.username = "This username is taken.";
  }
  const pwError = validatePasswordStrength(password);
  if (pwError) errors.password = pwError;
  if (roles.includes("admin") && !isAdmin(actor)) errors.roles = "Only administrators can grant the admin role.";
  if (Object.keys(errors).length) return fail(errors);

  let username = rawUsername;
  if (!username) {
    const base = slugify(email.split("@")[0] ?? name).replace(/-+/g, "-") || "member";
    const taken = new Set(db.users.map((u) => u.username.toLowerCase()));
    username = base;
    let i = 2;
    while (taken.has(username)) username = `${base}-${i++}`;
  }
  if (!roles.length) roles = ["student"];

  const now = new Date().toISOString();
  const user: User = {
    id: uid("usr"),
    username,
    name,
    email,
    passwordHash: await hashPassword(password),
    roles,
    enabled: true,
    personaCaptured: false,
    createdAt: now,
  };
  await mutate((d) => {
    d.users.push(user);
  });
  revalidateMember();
  await setFlash("Member added successfully", "success");
  redirect(`/admin/members/${user.id}`);
}

/** Update profile fields (name, username, headline, location, bio; email for admins). */
export async function updateMemberProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const db = await getDb();
  const id = fd(formData, "id");
  const target = db.users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (target.roles.includes("admin") && !isAdmin(actor)) return { ok: false, error: "Only administrators can edit an administrator's profile." };

  const name = fd(formData, "name");
  const username = fd(formData, "username").toLowerCase();
  const headline = fd(formData, "headline");
  const location = fd(formData, "location");
  const bio = fd(formData, "bio");
  const email = fd(formData, "email").toLowerCase();

  const errors: Errors = {};
  if (!name || name.length < 2 || name.length > 100) errors.name = "Please enter the member's full name.";
  if (!USERNAME_RE.test(username)) errors.username = "Use 3–40 lowercase letters, numbers, dashes or underscores.";
  else if (db.users.some((u) => u.id !== id && u.username.toLowerCase() === username)) errors.username = "This username is taken.";
  if (headline.length > 120) errors.headline = "Keep the headline under 120 characters.";
  if (location.length > 80) errors.location = "Keep the location under 80 characters.";
  if (bio.length > 2000) errors.bio = "Keep the bio under 2,000 characters.";
  const changeEmail = isAdmin(actor) && email && email !== target.email.toLowerCase();
  if (changeEmail) {
    if (!isValidEmail(email)) errors.email = "Please enter a valid email address.";
    else if (db.users.some((u) => u.id !== id && u.email.toLowerCase() === email)) errors.email = "A member with this email already exists.";
  }
  if (Object.keys(errors).length) return fail(errors);

  await mutate((d) => {
    const row = d.users.find((u) => u.id === id);
    if (!row) return;
    row.name = name;
    row.username = username;
    row.headline = headline || undefined;
    row.location = location || undefined;
    row.bio = bio || undefined;
    if (changeEmail) row.email = email;
  });
  revalidateMember(id, username);
  if (username !== target.username) revalidatePath(`/user/${target.username}`);
  return { ok: true, data: undefined, message: "Member updated" };
}

/** Replace a member's roles (moderators; admin role changes require an admin). */
export async function updateMemberRolesAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const db = await getDb();
  const id = fd(formData, "id");
  const target = db.users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "This member no longer exists." };

  let roles = readRoles(formData);
  const actorIsAdmin = isAdmin(actor);
  const targetIsAdmin = target.roles.includes("admin");
  if (targetIsAdmin && !actorIsAdmin) return { ok: false, error: "Only administrators can change an administrator's roles." };
  if (roles.includes("admin") && !targetIsAdmin && !actorIsAdmin) return { ok: false, error: "Only administrators can grant the admin role." };
  if (actor.id === target.id) {
    if (targetIsAdmin && !roles.includes("admin")) return { ok: false, error: "You cannot remove your own admin role." };
    if (!actorIsAdmin && target.roles.includes("moderator") && !roles.includes("moderator")) {
      return { ok: false, error: "You cannot remove your own moderator role." };
    }
  }
  if (targetIsAdmin && !roles.includes("admin") && otherEnabledAdmins(db, target.id) === 0) {
    return { ok: false, error: "There must be at least one administrator." };
  }
  if (!roles.length) roles = ["student"];

  await mutate((d) => {
    const row = d.users.find((u) => u.id === id);
    if (row) row.roles = roles;
  });
  revalidateMember(id, target.username);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Member updated" };
}

/** Enable or disable an account (admin only). Disabling signs the member out everywhere. */
export async function setMemberEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor)) return { ok: false, error: "Only administrators can enable or disable members." };
  const db = await getDb();
  const target = db.users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (target.id === actor.id) return { ok: false, error: "You cannot disable your own account." };
  if (!enabled && target.roles.includes("admin") && otherEnabledAdmins(db, target.id) === 0) {
    return { ok: false, error: "There must be at least one enabled administrator." };
  }
  await mutate((d) => {
    const row = d.users.find((u) => u.id === id);
    if (row) row.enabled = enabled;
  });
  if (!enabled) await destroyAllSessions(id);
  revalidateMember(id, target.username);
  return { ok: true, data: undefined, message: enabled ? `${target.name} can sign in again.` : `${target.name} has been disabled and signed out.` };
}

/** Set a new password for a member (admin only). */
export async function resetMemberPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor)) return { ok: false, error: "Only administrators can reset passwords." };
  const db = await getDb();
  const id = fd(formData, "id");
  const target = db.users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "This member no longer exists." };
  const password = fd(formData, "password");
  const confirm = fd(formData, "confirm");
  const errors: Errors = {};
  const pwError = validatePasswordStrength(password);
  if (pwError) errors.password = pwError;
  else if (password !== confirm) errors.confirm = "Passwords do not match.";
  if (Object.keys(errors).length) return fail(errors);

  const passwordHash = await hashPassword(password);
  await mutate((d) => {
    const row = d.users.find((u) => u.id === id);
    if (row) row.passwordHash = passwordHash;
  });
  if (fdBool(formData, "signOut") && target.id !== actor.id) await destroyAllSessions(id);
  revalidateMember(id);
  return { ok: true, data: undefined, message: `Password updated for ${target.name}.` };
}

/**
 * Permanently delete a member and their learning records (admin only).
 * Refused for yourself, the last administrator and members who own content.
 */
export async function deleteMemberAction(id: string): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isAdmin(actor)) return { ok: false, error: "Only administrators can delete members." };
  const db = await getDb();
  const target = db.users.find((u) => u.id === id);
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (target.id === actor.id) return { ok: false, error: "You cannot delete your own account." };
  if (target.roles.includes("admin") && otherEnabledAdmins(db, target.id) === 0) return { ok: false, error: "There must be at least one administrator." };

  const owns =
    db.courses.some((c) => c.createdById === id || c.instructorIds.includes(id) || c.evaluatorId === id) ||
    db.batches.some((b) => b.createdById === id || b.instructorIds.includes(id)) ||
    db.programs.some((p) => p.createdById === id) ||
    db.quizzes.some((q) => q.authorId === id) ||
    db.questions.some((q) => q.authorId === id) ||
    db.assignments.some((a) => a.authorId === id) ||
    db.exercises.some((e) => e.authorId === id) ||
    db.liveClasses.some((l) => l.hostId === id) ||
    db.jobs.some((j) => j.postedById === id);
  if (owns) {
    return { ok: false, error: "This member owns courses, batches or other content. Reassign it, or disable the account instead." };
  }

  await mutate((d) => {
    const mine = <T extends { userId: string }>(rows: T[]) => rows.filter((r) => r.userId !== id);
    d.users = d.users.filter((u) => u.id !== id);
    d.sessions = mine(d.sessions);
    d.enrollments = mine(d.enrollments);
    d.progress = mine(d.progress);
    d.videoWatches = mine(d.videoWatches);
    d.notes = mine(d.notes);
    d.reviews = mine(d.reviews);
    d.quizSubmissions = mine(d.quizSubmissions);
    d.quizViolations = mine(d.quizViolations);
    d.assignmentSubmissions = mine(d.assignmentSubmissions);
    d.exerciseSubmissions = mine(d.exerciseSubmissions);
    d.batchEnrollments = mine(d.batchEnrollments);
    d.batchFeedback = mine(d.batchFeedback);
    d.programMembers = mine(d.programMembers);
    d.certificates = mine(d.certificates);
    d.certificateRequests = mine(d.certificateRequests);
    d.certificateEvaluations = mine(d.certificateEvaluations);
    d.evaluatorSlots = d.evaluatorSlots.filter((s) => s.evaluatorId !== id);
    d.badgeAssignments = mine(d.badgeAssignments);
    d.activities = mine(d.activities);
    d.notifications = mine(d.notifications);
    d.jobApplications = mine(d.jobApplications);
    for (const lc of d.liveClasses) lc.attendeeIds = lc.attendeeIds.filter((a) => a !== id);
  });
  revalidateMember(undefined, target.username);
  revalidatePath("/", "layout");
  await setFlash("User deleted", "success");
  redirect("/admin/members");
}
