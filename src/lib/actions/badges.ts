"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Badge } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { grantBadge } from "@/lib/services/badges";
import { isBadgeEvent } from "@/components/admin/settings/badge-events";
import { fd, fdBool, isValidUrl, toDateKey, uid } from "@/lib/utils";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function revalidateBadges() {
  revalidatePath("/admin/settings/badges");
  revalidatePath("/", "layout");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Create or update a badge definition (Frappe: LMS Badge). */
export async function saveBadgeAction(_prev: ActionResult<{ id: string }> | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage badges." };
  const db = await getDb();
  const id = fd(formData, "id");
  const existing = id ? db.badges.find((b) => b.id === id) : null;
  if (id && !existing) return { ok: false, error: "This badge no longer exists." };

  const title = fd(formData, "title");
  const description = fd(formData, "description");
  const imageUrl = fd(formData, "imageUrl");
  const event = fd(formData, "event");
  const rawThreshold = fd(formData, "threshold");
  const grantOnlyOnce = fdBool(formData, "grantOnlyOnce");
  const enabled = fdBool(formData, "enabled");

  const errors: Record<string, string> = {};
  if (!title) errors.title = "Title is required";
  else if (title.length > 80) errors.title = "Keep the title under 80 characters.";
  else if (db.badges.some((b) => b.id !== id && b.title.toLowerCase() === title.toLowerCase())) errors.title = "A badge with this title already exists.";
  if (!description) errors.description = "Description is required";
  else if (description.length > 300) errors.description = "Keep the description under 300 characters.";
  if (!imageUrl) errors.imageUrl = "Badge Image is required";
  else if (!isValidUrl(imageUrl)) errors.imageUrl = "Upload an image or enter a valid image URL.";
  if (!event || !isBadgeEvent(event)) errors.event = "Event is required";
  let threshold: number | undefined;
  if (rawThreshold !== "") {
    const n = Number(rawThreshold);
    if (!Number.isInteger(n) || n < 0) errors.threshold = "Threshold must be a whole number of zero or more.";
    else if (event === "quiz_passed" && n > 100) errors.threshold = "A quiz score threshold cannot exceed 100%.";
    else threshold = n;
  }
  if (Object.keys(errors).length || !isBadgeEvent(event)) {
    return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
  }

  const badgeId = existing?.id ?? uid("bdg");
  await mutate((d) => {
    if (existing) {
      const row = d.badges.find((b) => b.id === existing.id);
      if (!row) return;
      row.title = title;
      row.description = description;
      row.imageUrl = imageUrl;
      row.event = event;
      row.threshold = threshold;
      row.grantOnlyOnce = grantOnlyOnce;
      row.enabled = enabled;
    } else {
      const badge: Badge = { id: badgeId, title, description, imageUrl, event, threshold, grantOnlyOnce, enabled, createdAt: new Date().toISOString() };
      d.badges.push(badge);
    }
  });
  revalidateBadges();
  return { ok: true, data: { id: badgeId }, message: existing ? "Badge updated successfully" : "Badge created successfully" };
}

export async function setBadgeEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage badges." };
  const found = await mutate((d) => {
    const row = d.badges.find((b) => b.id === id);
    if (!row) return false;
    row.enabled = enabled;
    return true;
  });
  if (!found) return { ok: false, error: "Error updating badge" };
  revalidateBadges();
  return { ok: true, data: undefined, message: enabled ? "Badge enabled" : "Badge disabled" };
}

/** Delete a badge and every assignment of it. */
export async function deleteBadgeAction(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage badges." };
  const removed = await mutate((d) => {
    if (!d.badges.some((b) => b.id === id)) return false;
    d.badges = d.badges.filter((b) => b.id !== id);
    d.badgeAssignments = d.badgeAssignments.filter((a) => a.badgeId !== id);
    return true;
  });
  if (!removed) return { ok: false, error: "Error deleting badge" };
  revalidateBadges();
  return { ok: true, data: undefined, message: "Badge deleted successfully" };
}

/** Award a badge to a member by hand (Frappe: Settings → Badge Assignments → Assign). */
export async function assignBadgeAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can assign badges." };
  const db = await getDb();
  const userId = fd(formData, "userId");
  const badgeId = fd(formData, "badgeId");
  const issuedOn = fd(formData, "issuedOn");

  const errors: Record<string, string> = {};
  const member = db.users.find((u) => u.id === userId);
  const badge = db.badges.find((b) => b.id === badgeId);
  if (!userId) errors.userId = "Member is required";
  else if (!member) errors.userId = "This member no longer exists.";
  if (!badgeId) errors.badgeId = "Badge is required";
  else if (!badge) errors.badgeId = "This badge no longer exists.";
  if (!issuedOn) errors.issuedOn = "Issued On is required";
  else if (!DATE_RE.test(issuedOn)) errors.issuedOn = "Enter a valid date.";
  else if (issuedOn > toDateKey()) errors.issuedOn = "Issued On cannot be in the future.";
  if (!errors.userId && !errors.badgeId && badge?.grantOnlyOnce && db.badgeAssignments.some((a) => a.badgeId === badgeId && a.userId === userId)) {
    errors.badgeId = `${member?.name ?? "This member"} already has this badge.`;
  }
  if (Object.keys(errors).length || !member || !badge) {
    return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
  }

  const before = new Set(db.badgeAssignments.map((a) => a.id));
  await grantBadge(member.id, badge.id);
  if (issuedOn !== toDateKey()) {
    await mutate((d) => {
      const created = d.badgeAssignments.find((a) => !before.has(a.id) && a.badgeId === badge.id && a.userId === member.id);
      if (created) created.issuedOn = issuedOn;
    });
  }
  revalidateBadges();
  revalidatePath(`/user/${member.username}`);
  return { ok: true, data: undefined, message: "Badge assigned successfully" };
}

export async function revokeBadgeAssignmentAction(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { ok: false, error: "Only administrators can manage badge assignments." };
  const removed = await mutate((d) => {
    const row = d.badgeAssignments.find((a) => a.id === id);
    if (!row) return null;
    d.badgeAssignments = d.badgeAssignments.filter((a) => a.id !== id);
    return { username: d.users.find((u) => u.id === row.userId)?.username };
  });
  if (!removed) return { ok: false, error: "Error deleting badge assignment" };
  revalidateBadges();
  if (removed.username) revalidatePath(`/user/${removed.username}`);
  return { ok: true, data: undefined, message: "Badge assignment deleted successfully" };
}
