"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Announcement } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, isModerator } from "@/lib/auth/session";
import { canManageBatch } from "@/lib/data/batches";
import { notifyMany } from "@/lib/services/notifications";
import { batchAudienceText, externalRecipientLimitMessage, queueBatchAnnouncementEmails, reserveExternalRecipients } from "@/lib/email";
import { fd, isValidEmail, splitList, stripMarkdown, truncate, uid } from "@/lib/utils";

/**
 * Post an announcement to a batch. Every enrolled student receives an in-app
 * notification; CC addresses are stored with the announcement.
 */
export async function createAnnouncementAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === fd(formData, "batchId"));
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  if (!canManageBatch(user, batch)) return { ok: false, error: "You are not permitted to make an announcement for this batch." };

  const students = db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId);
  const subject = fd(formData, "subject");
  const body = fd(formData, "body");
  const ccRaw = fd(formData, "cc");
  const cc = splitList(ccRaw).map((e) => e.toLowerCase());

  if (!students.length) return { ok: false, error: "No students in this batch" };
  const fieldErrors: Record<string, string> = {};
  if (!subject) fieldErrors.subject = "Subject is required";
  else if (subject.length > 160) fieldErrors.subject = "Keep the subject under 160 characters.";
  if (!body) fieldErrors.body = "Announcement is required";
  else if (body.length > 20000) fieldErrors.body = "Keep the announcement under 20,000 characters.";
  const invalid = cc.filter((e) => !isValidEmail(e));
  if (invalid.length) fieldErrors.cc = `Invalid email address${invalid.length > 1 ? "es" : ""}: ${invalid.join(", ")}`;
  else if (cc.length > 50) fieldErrors.cc = "Add at most 50 CC addresses.";
  if (!fieldErrors.cc && cc.length) {
    // CC addresses are external recipients of real email: limited per author.
    const quota = reserveExternalRecipients(user.id, new Set(cc).size);
    if (!quota.ok) fieldErrors.cc = externalRecipientLimitMessage(quota);
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const announcement: Announcement = {
    id: uid("ann"),
    batchId: batch.id,
    authorId: user.id,
    subject,
    body,
    cc: cc.length ? Array.from(new Set(cc)) : undefined,
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    d.announcements.push(announcement);
  });
  await notifyMany(
    students.filter((id) => id !== user.id),
    {
      type: "announcement",
      subject: batchAudienceText(db, batch, subject),
      message: truncate(stripMarkdown(batchAudienceText(db, batch, body)), 160),
      link: `/batches/${batch.slug}?tab=announcements`,
      fromUserId: user.id,
      // Students get the full announcement by email below instead of a notification copy.
      email: false,
    },
  );
  // Emails are rendered and queued after the response; the outbox delivers them.
  const mail = await queueBatchAnnouncementEmails(announcement.id, { allowCcOnly: isModerator(user) });
  revalidatePath(`/batches/${batch.slug}`);
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath("/", "layout");
  revalidatePath("/admin/emails");
  const emailed = mail.disabled ? "" : mail.queued ? ` and is being emailed to ${mail.queued} ${mail.queued === 1 ? "student" : "students"}` : "";
  const ccNote = mail.ccSkipped ? " The CC copy wasn't sent because no student receives this email." : "";
  return { ok: true, data: undefined, message: `Announcement has been sent successfully${emailed}.${ccNote}` };
}

export async function deleteAnnouncementAction(announcementId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const announcement = db.announcements.find((a) => a.id === announcementId);
  const batch = announcement?.batchId ? db.batches.find((b) => b.id === announcement.batchId) : null;
  if (!announcement || !batch) return { ok: false, error: "This announcement no longer exists." };
  if (!canManageBatch(user, batch)) return { ok: false, error: "You are not permitted to delete announcements for this batch." };
  await mutate((d) => {
    d.announcements = d.announcements.filter((a) => a.id !== announcement.id);
  });
  revalidatePath(`/batches/${batch.slug}`);
  revalidatePath(`/admin/batches/${batch.id}`);
  return { ok: true, data: undefined, message: "Announcement deleted" };
}
