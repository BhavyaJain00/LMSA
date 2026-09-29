"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, EmailTemplate } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser, hasRole } from "@/lib/auth/session";
import { canManageBatch } from "@/lib/data/batches";
import { fd, isValidEmail, splitList, uid } from "@/lib/utils";
import { queueBatchMessage } from "@/lib/email";

/** Placeholders the template editor understands (see the Emails tab). */
const KNOWN_PLACEHOLDERS = [
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
];

function unknownPlaceholders(text: string): string[] {
  const found = Array.from(text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)).map((m) => m[1]!);
  return Array.from(new Set(found.filter((p) => !KNOWN_PLACEHOLDERS.includes(p))));
}

async function guard(batchId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false as const, error: "This batch no longer exists." };
  if (!canManageBatch(user, batch) || !hasRole(user, "moderator", "batch_evaluator", "course_creator")) {
    return { ok: false as const, error: "You do not have permission to manage email templates." };
  }
  return { ok: true as const, user, batch, db };
}

export async function saveEmailTemplateAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const g = await guard(fd(formData, "batchId"));
  if (!g.ok) return g;
  const { batch, db } = g;
  const templateId = fd(formData, "templateId");
  const existing = templateId ? db.emailTemplates.find((t) => t.id === templateId && t.batchId === batch.id) : null;
  if (templateId && !existing) return { ok: false, error: "This template no longer exists." };

  const name = fd(formData, "name");
  const subject = fd(formData, "subject");
  const body = fd(formData, "body");
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Give the template a name.";
  else if (name.length > 80) fieldErrors.name = "Keep the name under 80 characters.";
  else if (db.emailTemplates.some((t) => t.batchId === batch.id && t.id !== templateId && t.name.toLowerCase() === name.toLowerCase())) {
    fieldErrors.name = "Another template for this batch already uses this name.";
  }
  if (!subject) fieldErrors.subject = "Add a subject line.";
  else if (subject.length > 200) fieldErrors.subject = "Keep the subject under 200 characters.";
  if (!body) fieldErrors.body = "Add the email content.";
  else if (body.length > 20000) fieldErrors.body = "Keep the content under 20,000 characters.";
  const unknownSubject = unknownPlaceholders(subject);
  const unknownBody = unknownPlaceholders(body);
  if (!fieldErrors.subject && unknownSubject.length) fieldErrors.subject = `Unknown placeholder: {{ ${unknownSubject[0]} }}`;
  if (!fieldErrors.body && unknownBody.length) fieldErrors.body = `Unknown placeholder: {{ ${unknownBody[0]} }}`;
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const now = new Date().toISOString();
  if (existing) {
    await mutate((d) => {
      const row = d.emailTemplates.find((t) => t.id === existing.id);
      if (row) Object.assign(row, { name, subject, body, updatedAt: now });
    });
  } else {
    const template: EmailTemplate = { id: uid("tpl"), name, subject, body, batchId: batch.id, createdAt: now, updatedAt: now };
    await mutate((d) => {
      d.emailTemplates.push(template);
    });
  }
  revalidatePath(`/admin/batches/${batch.id}`);
  return { ok: true, data: undefined, message: existing ? "Email Template updated successfully" : "Email Template created successfully" };
}

export async function deleteEmailTemplateAction(templateId: string): Promise<ActionResult> {
  const db = await getDb();
  const template = db.emailTemplates.find((t) => t.id === templateId);
  if (!template?.batchId) return { ok: false, error: "This template no longer exists." };
  const g = await guard(template.batchId);
  if (!g.ok) return g;
  await mutate((d) => {
    d.emailTemplates = d.emailTemplates.filter((t) => t.id !== template.id);
  });
  revalidatePath(`/admin/batches/${template.batchId}`);
  return { ok: true, data: undefined, message: "Email Template deleted" };
}

/**
 * Send a batch email: either a saved template (`templateId`) or an ad-hoc
 * subject/body, with optional CC addresses. The form must say who receives
 * it — `audience=all` (every enrolled student) or `audience=selected` with
 * `userId` fields; an empty selection is refused, never widened to everyone.
 * At least one student must actually receive it (CC alone never makes a
 * send), CC recipients count against the sender's quota, and the emails are
 * rendered and queued after the response.
 */
export async function sendBatchEmailAction(
  _prev: ActionResult<{ queued: number; skipped: number; cc: number }> | null,
  formData: FormData,
): Promise<ActionResult<{ queued: number; skipped: number; cc: number }>> {
  const g = await guard(fd(formData, "batchId"));
  if (!g.ok) return g;
  const { batch, db, user } = g;
  const templateId = fd(formData, "templateId");
  const template = templateId ? db.emailTemplates.find((t) => t.id === templateId && t.batchId === batch.id) : null;
  if (templateId && !template) return { ok: false, error: "This template no longer exists." };
  const subject = template ? template.subject : fd(formData, "subject");
  const body = template ? template.body : fd(formData, "body");
  const cc = Array.from(new Set(splitList(fd(formData, "cc")).map((e) => e.toLowerCase())));
  const audience = fd(formData, "audience");
  const userIds = Array.from(new Set(formData.getAll("userId").filter((v): v is string => typeof v === "string" && !!v)));

  const fieldErrors: Record<string, string> = {};
  if (!subject) fieldErrors.subject = "Add a subject line.";
  else if (subject.length > 200) fieldErrors.subject = "Keep the subject under 200 characters.";
  if (!body) fieldErrors.body = "Write the message.";
  else if (body.length > 20000) fieldErrors.body = "Keep the message under 20,000 characters.";
  const unknownSubject = unknownPlaceholders(subject);
  const unknownBody = unknownPlaceholders(body);
  if (!fieldErrors.subject && unknownSubject.length) fieldErrors.subject = `Unknown placeholder: {{ ${unknownSubject[0]} }}`;
  if (!fieldErrors.body && unknownBody.length) fieldErrors.body = `Unknown placeholder: {{ ${unknownBody[0]} }}`;
  const badCc = cc.find((e) => !isValidEmail(e));
  if (badCc) fieldErrors.cc = `"${badCc}" is not a valid email address.`;
  else if (cc.length > 50) fieldErrors.cc = "Add at most 50 CC addresses.";
  if (audience !== "all" && audience !== "selected") fieldErrors.recipients = "Choose who receives this email.";
  else if (audience === "selected" && !userIds.length) fieldErrors.recipients = "Choose at least one student to email.";
  else if (audience === "all" && userIds.length) fieldErrors.recipients = "Choose either all students or a selection.";
  else if (userIds.length > 5000) fieldErrors.recipients = "Too many recipients selected.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const enrolled = new Set(db.batchEnrollments.filter((e) => e.batchId === batch.id).map((e) => e.userId));
  if (userIds.some((id) => !enrolled.has(id))) return { ok: false, error: "Some selected recipients are not enrolled in this batch." };

  const result = await queueBatchMessage({ batchId: batch.id, subject, body, audience: audience === "selected" ? "selected" : "all", userIds: audience === "selected" ? userIds : undefined, cc, senderId: user.id });
  if (!result.ok) return result.field ? { ok: false, error: result.error, fieldErrors: { [result.field]: result.error } } : { ok: false, error: result.error };
  revalidatePath(`/admin/batches/${batch.id}`);
  revalidatePath("/admin/emails");
  const parts = [`Email queued for ${result.queued} ${result.queued === 1 ? "student" : "students"}`];
  if (result.ccQueued) parts.push(`${cc.length} CC`);
  if (result.skipped) parts.push(`${result.skipped} opted out`);
  return { ok: true, data: { queued: result.queued, skipped: result.skipped, cc: result.ccQueued ? cc.length : 0 }, message: parts.join(" · ") };
}
