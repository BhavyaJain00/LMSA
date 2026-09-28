"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, BatchFeedback } from "@/lib/types";
import { getDb, mutate } from "@/lib/db/store";
import { getCurrentUser } from "@/lib/auth/session";
import { getBatchStatus } from "@/lib/data/batches";
import { notifyMany } from "@/lib/services/notifications";
import { fd, uid } from "@/lib/utils";

function rating(formData: FormData, key: string): number | null {
  const n = Number(fd(formData, key));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** A learner's end-of-batch feedback (one per learner per batch). */
export async function submitBatchFeedbackAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "You must be logged in." };
  const db = await getDb();
  const batch = db.batches.find((b) => b.id === fd(formData, "batchId"));
  if (!batch) return { ok: false, error: "This batch no longer exists." };
  if (!db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === user.id)) {
    return { ok: false, error: "Only enrolled students can give feedback for this batch." };
  }
  if (getBatchStatus(batch) !== "completed") return { ok: false, error: "Feedback opens once the batch has ended." };
  if (db.batchFeedback.some((f) => f.batchId === batch.id && f.userId === user.id)) {
    return { ok: false, error: "You have already shared feedback for this batch." };
  }

  const contentRating = rating(formData, "contentRating");
  const instructorsRating = rating(formData, "instructorsRating");
  const valueRating = rating(formData, "valueRating");
  const feedback = fd(formData, "feedback");
  const fieldErrors: Record<string, string> = {};
  if (!contentRating) fieldErrors.contentRating = "Rate the content from 1 to 5 stars.";
  if (!instructorsRating) fieldErrors.instructorsRating = "Rate the instructors from 1 to 5 stars.";
  if (!valueRating) fieldErrors.valueRating = "Rate the value from 1 to 5 stars.";
  if (feedback.length > 5000) fieldErrors.feedback = "Keep your feedback under 5,000 characters.";
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const row: BatchFeedback = {
    id: uid("bf"),
    batchId: batch.id,
    userId: user.id,
    feedback,
    contentRating: contentRating!,
    instructorsRating: instructorsRating!,
    valueRating: valueRating!,
    createdAt: new Date().toISOString(),
  };
  await mutate((d) => {
    if (!d.batchFeedback.some((f) => f.batchId === batch.id && f.userId === user.id)) d.batchFeedback.push(row);
  });
  await notifyMany(batch.instructorIds, {
    type: "system",
    subject: `${user.name} left feedback for ${batch.title}`,
    message: `Content ${row.contentRating}/5 · Instructors ${row.instructorsRating}/5 · Value ${row.valueRating}/5`,
    link: `/admin/batches/${batch.id}`,
    fromUserId: user.id,
  });
  revalidatePath(`/batches/${batch.slug}`);
  revalidatePath(`/admin/batches/${batch.id}`);
  return { ok: true, data: undefined, message: "Thank you for providing your feedback." };
}
