"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Database, PublicUser, Role, User } from "@/lib/types";
import { destroyAllSessions, getCurrentUser, isAdmin, isModerator, toPublicUser } from "@/lib/auth/session";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { getDb, mutate } from "@/lib/db/store";
import { isRole } from "@/components/admin/settings/roles";
import { MEMBER_IMPORT_MAX_ROWS, parseRoleList, type MemberImportRow } from "@/components/admin/settings/member-import-csv";
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

interface NewMemberInput {
  name: string;
  /** Lower-cased. */
  email: string;
  /** Lower-cased; empty to generate one from the email. */
  username: string;
  password: string;
  roles: Role[];
}

/**
 * Field errors for a new member (the Add member form and the CSV import
 * share these rules). `takenEmails`/`takenUsernames` hold lower-cased values
 * that already exist, including rows earlier in the same import.
 */
function validateNewMember(actor: User, input: NewMemberInput, takenEmails: Set<string>, takenUsernames: Set<string>): Errors {
  const errors: Errors = {};
  if (!input.email) errors.email = "Email is required";
  else if (input.email.length > 254 || !isValidEmail(input.email)) errors.email = "Please enter a valid email address.";
  else if (takenEmails.has(input.email)) errors.email = "A member with this email already exists.";
  if (!input.name) errors.name = "Full name is required";
  else if (input.name.length < 2 || input.name.length > 100) errors.name = "Please enter the member's full name.";
  if (input.username) {
    if (!USERNAME_RE.test(input.username)) errors.username = "Use 3–40 lowercase letters, numbers, dashes or underscores.";
    else if (takenUsernames.has(input.username)) errors.username = "This username is taken.";
  }
  const pwError = validatePasswordStrength(input.password);
  if (pwError) errors.password = pwError;
  if (input.roles.includes("admin") && !isAdmin(actor)) errors.roles = "Only administrators can grant the admin role.";
  return errors;
}

/** A free username derived from the email (or name); `taken` holds lower-cased usernames. */
function deriveUsername(email: string, name: string, taken: Set<string>): string {
  const base = slugify(email.split("@")[0] || name).replace(/-+/g, "-") || "member";
  let username = base;
  let i = 2;
  while (taken.has(username)) username = `${base}-${i++}`;
  return username;
}

function buildMember(input: NewMemberInput, username: string, passwordHash: string, now: string): User {
  return {
    id: uid("usr"),
    username,
    name: input.name,
    email: input.email,
    passwordHash,
    roles: input.roles.length ? input.roles : ["student"],
    enabled: true,
    personaCaptured: false,
    createdAt: now,
  };
}

/** Validate and store a new member. Callers must have checked the moderator permission. */
async function insertMember(actor: User, formData: FormData): Promise<ActionResult<User>> {
  const db = await getDb();
  const input: NewMemberInput = {
    name: fd(formData, "name"),
    email: fd(formData, "email").toLowerCase(),
    username: fd(formData, "username").toLowerCase(),
    password: fd(formData, "password"),
    roles: readRoles(formData),
  };
  const takenEmails = new Set(db.users.map((u) => u.email.toLowerCase()));
  const takenUsernames = new Set(db.users.map((u) => u.username.toLowerCase()));
  const errors = validateNewMember(actor, input, takenEmails, takenUsernames);
  if (Object.keys(errors).length) return fail(errors);

  const passwordHash = await hashPassword(input.password);
  const result = await mutate((d): ActionResult<User> => {
    // Re-check against live data: another request may have added this member meanwhile.
    if (d.users.some((u) => u.email.toLowerCase() === input.email)) return fail({ email: "A member with this email already exists." });
    const taken = new Set(d.users.map((u) => u.username.toLowerCase()));
    if (input.username && taken.has(input.username)) return fail({ username: "This username is taken." });
    const user = buildMember(input, input.username || deriveUsername(input.email, input.name, taken), passwordHash, new Date().toISOString());
    d.users.push(user);
    return { ok: true, data: user };
  });
  if (result.ok) revalidateMember();
  return result;
}

/** Add a member with a password and roles. */
export async function createMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const result = await insertMember(actor, formData);
  if (!result.ok) return result;
  await setFlash("Member added successfully", "success");
  redirect(`/admin/members/${result.data.id}`);
}

/**
 * Add a member from another form (e.g. the course instructor or evaluator
 * picker) and return them instead of redirecting, so unsaved edits survive.
 */
export async function createMemberInlineAction(_prev: ActionResult<PublicUser> | null, formData: FormData): Promise<ActionResult<PublicUser>> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const result = await insertMember(actor, formData);
  if (!result.ok) return result;
  return { ok: true, data: toPublicUser(result.data), message: `${result.data.name} was added as a member.` };
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
    // Their discussion threads go too, with every reply posted under them.
    const removedTopics = new Set(d.discussionTopics.filter((t) => t.authorId === id).map((t) => t.id));
    d.discussionTopics = d.discussionTopics.filter((t) => !removedTopics.has(t.id));
    d.discussionReplies = d.discussionReplies.filter((r) => r.authorId !== id && !removedTopics.has(r.topicId));
    // Orders are kept for the books, but unconfirmed ones can no longer be fulfilled
    // and must stop reserving coupon uses.
    for (const p of d.payments) if (p.userId === id && p.status === "pending") p.status = "failed";
    for (const lc of d.liveClasses) lc.attendeeIds = lc.attendeeIds.filter((a) => a !== id);
  });
  revalidateMember(undefined, target.username);
  revalidatePath("/", "layout");
  await setFlash("User deleted", "success");
  redirect("/admin/members");
}

/* ------------------------------------------------------------------ */
/* Bulk import (CSV)                                                   */
/* ------------------------------------------------------------------ */

export interface MemberImportCheck {
  line: number;
  email: string;
  name: string;
  roles: Role[];
  /** No password in the file: one is generated on import. */
  generatePassword: boolean;
  errors: string[];
}

export interface MemberImportCreated {
  line: number;
  id: string;
  name: string;
  email: string;
  username: string;
  roles: Role[];
  /** Only set when the password was generated (shown once so it can be shared). */
  generatedPassword?: string;
}

export interface MemberImportResult {
  created: MemberImportCreated[];
  skipped: { line: number; email: string; errors: string[] }[];
}

/** Coerce untrusted client rows into clean import rows (the browser parses the CSV). */
function sanitizeImportRows(input: unknown): MemberImportRow[] | null {
  if (!Array.isArray(input) || input.length > MEMBER_IMPORT_MAX_ROWS) return null;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return input.map((raw, i) => {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const line = typeof r.line === "number" && Number.isInteger(r.line) && r.line > 0 ? r.line : i + 2;
    return {
      line,
      email: str(r.email, 320).trim().toLowerCase(),
      name: str(r.name, 200).trim().replace(/\s+/g, " "),
      roles: str(r.roles, 200),
      password: str(r.password, 200),
    };
  });
}

/**
 * Per-row validation shared by the preview and the import: the Add member
 * rules plus duplicate emails inside the file and unknown roles.
 */
function checkImportRows(actor: User, db: Database, rows: MemberImportRow[]): MemberImportCheck[] {
  const takenEmails = new Set(db.users.map((u) => u.email.toLowerCase()));
  const takenUsernames = new Set(db.users.map((u) => u.username.toLowerCase()));
  const firstLine = new Map<string, number>();
  return rows.map((row) => {
    const { roles, invalid } = parseRoleList(row.roles);
    const generatePassword = row.password === "";
    const errors: string[] = [];
    const fieldErrors = validateNewMember(
      actor,
      // A generated password always passes the strength rule, so check a stand-in that does too.
      { name: row.name, email: row.email, username: "", password: generatePassword ? "generated1" : row.password, roles },
      takenEmails,
      takenUsernames,
    );
    if (fieldErrors.email) errors.push(fieldErrors.email);
    else if (row.email) {
      const seen = firstLine.get(row.email);
      if (seen !== undefined) errors.push(`Duplicate email: already used on line ${seen} of this file.`);
      else firstLine.set(row.email, row.line);
    }
    if (fieldErrors.name) errors.push(fieldErrors.name);
    if (invalid.length) {
      errors.push(
        `Unknown ${invalid.length === 1 ? "role" : "roles"} ${invalid.map((r) => `“${r}”`).join(", ")}. Use student, course_creator, batch_evaluator, moderator or admin.`,
      );
    }
    if (fieldErrors.roles) errors.push(fieldErrors.roles);
    if (fieldErrors.password) errors.push(fieldErrors.password);
    return { line: row.line, email: row.email, name: row.name, roles: roles.length ? roles : ["student"], generatePassword, errors };
  });
}

/** Random password with letters and digits that passes the strength rule. */
function generatePassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < 12) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

/** Validate parsed CSV rows for the import preview (moderators). */
export async function checkMemberImportAction(rows: MemberImportRow[]): Promise<ActionResult<MemberImportCheck[]>> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const clean = sanitizeImportRows(rows);
  if (!clean) return { ok: false, error: `Import between 1 and ${MEMBER_IMPORT_MAX_ROWS} members at a time.` };
  if (!clean.length) return { ok: false, error: "The file has no member rows." };
  const db = await getDb();
  return { ok: true, data: checkImportRows(actor, db, clean) };
}

/**
 * Create every valid row as a member (same rules as Add member). Rows with
 * errors are skipped and reported; generated passwords are returned once.
 */
export async function importMembersAction(rows: MemberImportRow[]): Promise<ActionResult<MemberImportResult>> {
  const actor = await getCurrentUser();
  if (!actor || !isModerator(actor)) return { ok: false, error: "You are not permitted to manage members." };
  const clean = sanitizeImportRows(rows);
  if (!clean) return { ok: false, error: `Import between 1 and ${MEMBER_IMPORT_MAX_ROWS} members at a time.` };
  if (!clean.length) return { ok: false, error: "The file has no member rows." };

  const db = await getDb();
  const checks = checkImportRows(actor, db, clean);
  const skipped: MemberImportResult["skipped"] = [];
  const valid: { row: MemberImportRow; check: MemberImportCheck; password: string }[] = [];
  for (let i = 0; i < clean.length; i++) {
    const row = clean[i];
    const check = checks[i];
    if (check.errors.length) skipped.push({ line: row.line, email: row.email, errors: check.errors });
    else valid.push({ row, check, password: check.generatePassword ? generatePassword() : row.password });
  }
  // scrypt is deliberately slow and memory hungry: hash a few at a time.
  const ready: { row: MemberImportRow; check: MemberImportCheck; password: string; hash: string }[] = [];
  for (let i = 0; i < valid.length; i += 4) {
    const chunk = valid.slice(i, i + 4);
    const hashes = await Promise.all(chunk.map((v) => hashPassword(v.password)));
    chunk.forEach((v, k) => ready.push({ ...v, hash: hashes[k] }));
  }

  const created = await mutate((d) => {
    const out: MemberImportCreated[] = [];
    const emails = new Set(d.users.map((u) => u.email.toLowerCase()));
    const usernames = new Set(d.users.map((u) => u.username.toLowerCase()));
    const now = new Date().toISOString();
    for (const { row, check, password, hash } of ready) {
      // Another request may have added this email since the check.
      if (emails.has(row.email)) {
        skipped.push({ line: row.line, email: row.email, errors: ["A member with this email already exists."] });
        continue;
      }
      const input: NewMemberInput = { name: row.name, email: row.email, username: "", password, roles: check.roles };
      const user = buildMember(input, deriveUsername(row.email, row.name, usernames), hash, now);
      d.users.push(user);
      emails.add(user.email);
      usernames.add(user.username);
      out.push({
        line: row.line,
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        roles: user.roles,
        generatedPassword: check.generatePassword ? password : undefined,
      });
    }
    return out;
  });

  skipped.sort((a, b) => a.line - b.line);
  if (created.length) revalidateMember();
  const message = created.length
    ? `Imported ${created.length} ${created.length === 1 ? "member" : "members"}${skipped.length ? `, skipped ${skipped.length}` : ""}.`
    : "No members were imported.";
  return { ok: true, data: { created, skipped }, message };
}
