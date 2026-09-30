"use server";

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, EducationDetail, Role, SocialLinks, User, WorkExperience } from "@/lib/types";
import { findById, getDb, mutate, removeWhere, update } from "@/lib/db/store";
import { destroyAllSessions, destroySession, getCurrentUser, isAdmin, isModerator } from "@/lib/auth/session";
import { notify } from "@/lib/services/notifications";
import { setFlash } from "@/lib/flash";
import { roleLabels, siteConfig } from "@/lib/config";
import { audit } from "@/lib/audit";
import { fd, isValidUrl, toDateKey, uid } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

// Same rule as the member admin (actions/members.ts): 3–40 characters.
const USERNAME_RE = /^[a-z0-9](?:[a-z0-9_-]{1,38}[a-z0-9])?$/;
const RESERVED_USERNAMES = new Set(["new", "edit", "admin", "me", "you", "settings", "api", "login", "logout", "register"]);
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const ALL_ROLES: Role[] = ["student", "course_creator", "moderator", "batch_evaluator", "admin"];

function isHttpUrl(value: string): boolean {
  return isValidUrl(value) && !value.startsWith("/");
}

function isAssetUrl(value: string): boolean {
  return isValidUrl(value);
}

function parseJsonArray(raw: string): unknown[] | null {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseSkills(raw: string): string[] {
  const parsed = parseJsonArray(raw);
  const list = parsed ?? raw.split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const skill = str(item, 40);
    if (!skill) continue;
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out.slice(0, 30);
}

function parseEducation(raw: string, errors: Record<string, string>): EducationDetail[] {
  const parsed = parseJsonArray(raw);
  if (parsed === null) {
    errors.education = "Education could not be read. Please try again.";
    return [];
  }
  const out: EducationDetail[] = [];
  const thisYear = new Date().getFullYear();
  for (const entry of parsed.slice(0, 20)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const institution = str(e.institution, 120);
    const degree = str(e.degree, 120);
    const fieldOfStudy = str(e.fieldOfStudy, 120);
    const startYear = Number(e.startYear) || undefined;
    const endYear = Number(e.endYear) || undefined;
    if (!institution && !degree && !fieldOfStudy) continue;
    if (!institution || !degree) {
      errors.education = "Each education entry needs an institution and a degree.";
      continue;
    }
    for (const y of [startYear, endYear]) {
      if (y !== undefined && (!Number.isInteger(y) || y < 1940 || y > thisYear + 10)) {
        errors.education = `Years must be between 1940 and ${thisYear + 10}.`;
      }
    }
    if (startYear && endYear && endYear < startYear) errors.education = "An end year can't be before its start year.";
    out.push({
      id: str(e.id, 40) || uid("ed"),
      institution,
      degree,
      fieldOfStudy: fieldOfStudy || undefined,
      startYear,
      endYear,
    });
  }
  return out;
}

function parseWork(raw: string, errors: Record<string, string>): WorkExperience[] {
  const parsed = parseJsonArray(raw);
  if (parsed === null) {
    errors.workExperience = "Work experience could not be read. Please try again.";
    return [];
  }
  const out: WorkExperience[] = [];
  for (const entry of parsed.slice(0, 20)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const company = str(e.company, 120);
    const title = str(e.title, 120);
    const location = str(e.location, 120);
    const description = str(e.description, 1000);
    const startDate = str(e.startDate, 7);
    const current = e.current === true;
    const endDate = current ? "" : str(e.endDate, 7);
    if (!company && !title && !description) continue;
    if (!company || !title) {
      errors.workExperience = "Each position needs a company and a job title.";
      continue;
    }
    if ((startDate && !MONTH_RE.test(startDate)) || (endDate && !MONTH_RE.test(endDate))) {
      errors.workExperience = "Dates must be in the YYYY-MM format.";
    }
    if (startDate && endDate && endDate < startDate) errors.workExperience = "An end date can't be before its start date.";
    out.push({
      id: str(e.id, 40) || uid("we"),
      company,
      title,
      location: location || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      current: current || undefined,
      description: description || undefined,
    });
  }
  return out;
}

async function currentTokenHash(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(siteConfig.sessionCookie)?.value;
  return token ? createHash("sha256").update(token).digest("hex") : null;
}

function canEditUser(viewer: User, target: User): boolean {
  if (viewer.id === target.id) return true;
  if (!isModerator(viewer)) return false;
  // Only administrators may edit another administrator.
  return !target.roles.includes("admin") || isAdmin(viewer);
}

function revalidateProfile(...usernames: string[]) {
  for (const u of usernames) revalidatePath(`/user/${u}`, "layout");
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export async function updateProfileAction(_prev: ActionResult<{ username: string }> | null, formData: FormData): Promise<ActionResult<{ username: string }>> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in to edit a profile." };
  const target = await findById("users", fd(formData, "userId"));
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (!canEditUser(viewer, target)) return { ok: false, error: "You can only edit your own profile." };

  const errors: Record<string, string> = {};
  const name = fd(formData, "name").replace(/\s+/g, " ");
  const username = fd(formData, "username").toLowerCase();
  const headline = fd(formData, "headline");
  const location = fd(formData, "location");
  const openToRaw = fd(formData, "openTo");
  const bio = fd(formData, "bio");
  const avatarUrl = fd(formData, "avatarUrl");
  const coverImageUrl = fd(formData, "coverImageUrl");

  if (name.length < 2) errors.name = "Please enter your full name.";
  else if (name.length > 80) errors.name = "Name must be 80 characters or fewer.";
  // Only a new username is checked against the format and reserved names, so accounts
  // whose existing username predates these rules (e.g. the bootstrap "admin") can still save.
  const usernameChanged = username !== target.username.toLowerCase();
  if (!username) errors.username = "Please choose a username.";
  else if (usernameChanged && !USERNAME_RE.test(username)) errors.username = "Use 3–40 lowercase letters, numbers, dashes or underscores.";
  else if (usernameChanged && RESERVED_USERNAMES.has(username)) errors.username = "This username is reserved. Please pick another.";
  if (headline.length > 120) errors.headline = "Headline must be 120 characters or fewer.";
  if (location.length > 80) errors.location = "Location must be 80 characters or fewer.";
  const openTo: User["openTo"] = openToRaw === "work" || openToRaw === "hiring" ? openToRaw : undefined;
  if (openToRaw && !openTo) errors.openTo = "Choose Work, Hiring or leave it empty.";
  if (bio.length > 5000) errors.bio = "Bio must be 5,000 characters or fewer.";
  if (avatarUrl && !isAssetUrl(avatarUrl)) errors.avatarUrl = "Please upload a valid image.";
  if (coverImageUrl && !isAssetUrl(coverImageUrl)) errors.coverImageUrl = "Please upload a valid image.";

  const socials: SocialLinks = {};
  for (const key of ["website", "linkedin", "github", "x", "youtube"] as const) {
    const value = fd(formData, `social_${key}`);
    if (!value) continue;
    if (!isHttpUrl(value)) errors[`social_${key}`] = "Enter a full URL starting with https://";
    else socials[key] = value;
  }

  const skills = parseSkills(fd(formData, "skills"));
  const education = parseEducation(fd(formData, "education"), errors);
  const workExperience = parseWork(fd(formData, "workExperience"), errors);

  if (!errors.username && usernameChanged) {
    const db = await getDb();
    if (db.users.some((u) => u.id !== target.id && u.username.toLowerCase() === username)) errors.username = "This username is already taken.";
  }

  if (Object.keys(errors).length) {
    return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: errors };
  }

  await update("users", target.id, {
    name,
    username,
    headline: headline || undefined,
    location: location || undefined,
    openTo,
    bio: bio || undefined,
    avatarUrl: avatarUrl || undefined,
    coverImageUrl: coverImageUrl || undefined,
    socials,
    skills,
    education,
    workExperience,
  });

  revalidateProfile(target.username, username);
  await setFlash(viewer.id === target.id ? "Profile updated successfully" : `${name}'s profile was updated`);
  redirect(`/user/${username}`);
}

/** Set or remove the cover image straight from the profile header. */
export async function updateCoverImageAction(userId: string, url: string): Promise<ActionResult> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in." };
  const target = await findById("users", userId);
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (!canEditUser(viewer, target)) return { ok: false, error: "You can only change your own cover image." };
  const value = url.trim();
  if (value && !isAssetUrl(value)) return { ok: false, error: "Only image files are allowed." };
  if (value && !/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(value)) return { ok: false, error: "Only image file is allowed." };
  await update("users", target.id, { coverImageUrl: value || undefined });
  revalidateProfile(target.username);
  return { ok: true, data: undefined, message: value ? "Cover image updated" : "Cover image removed" };
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export async function setUserRoleAction(userId: string, role: Role, enabled: boolean): Promise<ActionResult<{ roles: Role[] }>> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in." };
  if (!isModerator(viewer)) return { ok: false, error: "Only moderators can change roles." };
  if (!ALL_ROLES.includes(role)) return { ok: false, error: "Unknown role." };
  if (role === "admin" && !isAdmin(viewer)) return { ok: false, error: "Only administrators can grant or remove the Admin role." };

  const target = await findById("users", userId);
  if (!target) return { ok: false, error: "This member no longer exists." };
  if (target.roles.includes("admin") && !isAdmin(viewer)) return { ok: false, error: "Only administrators can change an administrator's roles." };
  if (target.id === viewer.id && !enabled && (role === "moderator" || role === "admin")) {
    return { ok: false, error: `You can't remove your own ${roleLabels[role]} role.` };
  }

  const has = target.roles.includes(role);
  if (has === enabled) return { ok: true, data: { roles: target.roles }, message: "Role updated successfully" };
  const roles = enabled ? [...target.roles, role] : target.roles.filter((r) => r !== role);
  if (roles.length === 0) return { ok: false, error: "A member needs at least one role." };
  const ordered = ALL_ROLES.filter((r) => roles.includes(r));

  await update("users", target.id, { roles: ordered });
  await audit(viewer, "user.roles", { type: "user", id: target.id }, { from: target.roles.join(","), to: ordered.join(",") });
  if (enabled && target.id !== viewer.id) {
    await notify(target.id, {
      type: "system",
      subject: `You are now ${role === "admin" ? "an" : "a"} ${roleLabels[role]}`,
      message: `${viewer.name} gave you the ${roleLabels[role]} role.`,
      link: `/user/${target.username}`,
      fromUserId: viewer.id,
    });
  }
  revalidateProfile(target.username);
  return { ok: true, data: { roles: ordered }, message: "Role updated successfully" };
}

/* ------------------------------------------------------------------ */
/* Evaluations                                                         */
/* ------------------------------------------------------------------ */

/** Cancel a booked certificate evaluation (the learner, the evaluator or a moderator). */
export async function cancelEvaluationAction(requestId: string): Promise<ActionResult> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in." };
  const request = await findById("certificateRequests", requestId);
  if (!request) return { ok: false, error: "This evaluation no longer exists." };
  const isOwner = request.userId === viewer.id;
  const isEvaluatorOfRequest = request.evaluatorId === viewer.id;
  if (!isOwner && !isEvaluatorOfRequest && !isModerator(viewer)) return { ok: false, error: "You can't cancel this evaluation." };
  if (request.status !== "upcoming") return { ok: false, error: "This evaluation is no longer upcoming." };
  if (request.date <= toDateKey()) return { ok: false, error: "Only evaluations scheduled for a future date can be cancelled." };

  await update("certificateRequests", request.id, { status: "cancelled" });

  const db = await getDb();
  const course = db.courses.find((c) => c.id === request.courseId);
  const courseTitle = course?.title ?? "the course";
  const recipients = new Set<string>();
  if (!isOwner) recipients.add(request.userId);
  if (!isEvaluatorOfRequest) recipients.add(request.evaluatorId);
  for (const id of recipients) {
    const recipient = db.users.find((u) => u.id === id);
    await notify(id, {
      type: "system",
      subject: `Evaluation cancelled: ${courseTitle}`,
      message: `${viewer.name} cancelled the evaluation scheduled for ${request.date} at ${request.startTime}.`,
      link: id === request.evaluatorId && recipient ? `/user/${recipient.username}/schedule` : course ? `/courses/${course.slug}` : undefined,
      fromUserId: viewer.id,
    });
  }

  revalidatePath("/dashboard");
  revalidatePath("/admin");
  if (course) revalidatePath(`/courses/${course.slug}`, "layout");
  return { ok: true, data: undefined, message: "Evaluation cancelled successfully" };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/** Sign out of every device, including this one. */
export async function logoutEverywhereAction(): Promise<void> {
  const viewer = await getCurrentUser();
  if (!viewer) redirect("/login");
  await destroyAllSessions(viewer.id);
  await destroySession();
  await setFlash("You have been logged out on all devices.", "info");
  redirect("/login");
}

/** Sign out of every other device and keep this session. */
export async function logoutOtherSessionsAction(): Promise<ActionResult<{ removed: number }>> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in." };
  const current = await currentTokenHash();
  const removed = await removeWhere("sessions", (s) => s.userId === viewer.id && s.tokenHash !== current);
  revalidatePath("/settings");
  return {
    ok: true,
    data: { removed },
    message: removed ? `Logged out of ${removed} other ${removed === 1 ? "session" : "sessions"}.` : "There were no other sessions to log out.",
  };
}

/** Remove one specific session (not the current one). */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const viewer = await getCurrentUser();
  if (!viewer) return { ok: false, error: "You must be logged in." };
  const current = await currentTokenHash();
  let outcome = "missing" as "removed" | "missing" | "current";
  await mutate((db) => {
    const idx = db.sessions.findIndex((s) => s.id === sessionId && s.userId === viewer.id);
    if (idx === -1) return;
    if (db.sessions[idx]!.tokenHash === current) {
      outcome = "current";
      return;
    }
    db.sessions.splice(idx, 1);
    outcome = "removed";
  });
  if (outcome === "current") return { ok: false, error: "Use Log out to end the session on this device." };
  if (outcome === "missing") return { ok: false, error: "This session has already ended." };
  revalidatePath("/settings");
  return { ok: true, data: undefined, message: "Session logged out." };
}
