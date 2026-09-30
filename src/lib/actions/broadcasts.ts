"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, SegmentFilter, User } from "@/lib/types";
import { getCurrentUser, isAdmin, isModerator } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { fd, fdBool } from "@/lib/utils";
import { cleanSegmentFilter, previewSegment, type SegmentPreview } from "@/lib/comms/audience";
import {
  cancelBroadcast,
  deleteBroadcast,
  duplicateBroadcast,
  getBroadcast,
  pauseBroadcast,
  resumeBroadcast,
  saveBroadcast,
  scheduleBroadcast,
  startBroadcast,
  unscheduleBroadcast,
} from "@/lib/comms/broadcasts";
import { type CampaignKind, CONTENT_LIMITS, checkContent } from "@/lib/comms/campaign-core";
import { type CampaignPreview, courseValuesFor, describeTestSend, previewCampaign, sendCampaignTest } from "@/lib/comms/preview";
import { runComms } from "@/lib/comms/runner";

/**
 * Broadcast administration (moderators and admins): audience segments,
 * composing, testing, scheduling and sending broadcasts, and the email
 * tracking settings. Every action re-checks the caller's role.
 */

const STAFF_ONLY = "Only moderators and administrators can manage broadcasts.";

async function broadcastStaff(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isModerator(user) ? user : null;
}

/* ------------------------------------------------------------------ */
/* Segments                                                            */
/* ------------------------------------------------------------------ */

/** Live recipient count, exclusions and a sample for the segment builder. */
export async function previewSegmentAction(filter: SegmentFilter): Promise<ActionResult<SegmentPreview>> {
  if (!(await broadcastStaff())) return { ok: false, error: STAFF_ONLY };
  try {
    return { ok: true, data: await previewSegment(await cleanSegmentFilter(filter)) };
  } catch (error) {
    console.error("[broadcasts] segment preview failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The audience couldn't be counted. Please try again." };
  }
}

/* ------------------------------------------------------------------ */
/* Tracking settings                                                   */
/* ------------------------------------------------------------------ */

export async function saveEmailTrackingAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change email tracking." };
  const trackOpens = fdBool(formData, "trackOpens");
  const trackClicks = fdBool(formData, "trackClicks");
  const before = await mutate((db) => {
    const previous = { trackOpens: db.settings.email.trackOpens, trackClicks: db.settings.email.trackClicks };
    db.settings.email = { ...db.settings.email, trackOpens, trackClicks };
    db.settings.updatedAt = new Date().toISOString();
    return previous;
  });
  await audit(user, "settings.update", { type: "settings", id: "email-tracking" }, {
    section: "email-tracking",
    trackOpens,
    trackClicks,
    changed: before.trackOpens !== trackOpens || before.trackClicks !== trackClicks,
  });
  revalidatePath("/", "layout");
  const message =
    trackOpens && trackClicks
      ? "Open and click tracking are on"
      : trackOpens
        ? "Open tracking is on, click tracking is off"
        : trackClicks
          ? "Click tracking is on, open tracking is off"
          : "Email tracking is off";
  return { ok: true, data: undefined, message };
}

/* ------------------------------------------------------------------ */
/* Composing                                                           */
/* ------------------------------------------------------------------ */

function parseJson(raw: string): unknown {
  if (!raw || raw.length > 20_000) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** Create or update a draft, then open its review page. */
export async function saveBroadcastAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const id = fd(formData, "id") || undefined;
  const result = await saveBroadcast(user, {
    id,
    subject: fd(formData, "subject"),
    preheader: fd(formData, "preheader"),
    body: String(formData.get("body") ?? ""),
    segment: parseJson(fd(formData, "segment")),
  });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: result.fieldErrors };
  if (!id) await audit(user, "broadcast.create", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject });
  revalidatePath("/admin/broadcasts", "layout");
  await setFlash(id ? "Broadcast saved" : "Draft saved");
  redirect(`/admin/broadcasts/${result.broadcast.id}`);
}

export interface EmailPreviewInput {
  kind: CampaignKind;
  subject: string;
  preheader?: string;
  body: string;
  /** Sequence emails: the course that fills `{{ course_title }}` and `{{ course_url }}`. */
  courseId?: string;
}

/** The email as the staff member would receive it, plus anything that would stop it from being saved. */
export async function previewEmailAction(input: EmailPreviewInput): Promise<ActionResult<CampaignPreview & { problems: string[] }>> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const kind: CampaignKind = input?.kind === "sequence" ? "sequence" : "broadcast";
  if (typeof input?.body !== "string" || input.body.length > CONTENT_LIMITS.body * 2) return { ok: false, error: "The message is too long to preview." };
  const checked = checkContent(input, kind);
  try {
    const preview = await previewCampaign(
      user,
      { subject: checked.value.subject || "(no subject)", preheader: checked.value.preheader, body: checked.value.body },
      kind === "sequence" ? await courseValuesFor(typeof input.courseId === "string" ? input.courseId : undefined) : {},
    );
    return { ok: true, data: { ...preview, problems: Object.values(checked.errors) } };
  } catch (error) {
    console.error("[broadcasts] preview failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The preview couldn't be rendered. Please try again." };
  }
}

/** Send a test copy of a saved broadcast to the staff member or a few other addresses. */
export async function sendBroadcastTestAction(id: string, to: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const broadcast = await getBroadcast(String(id));
  if (!broadcast) return { ok: false, error: "This broadcast no longer exists." };
  const result = await sendCampaignTest(user, broadcast, typeof to === "string" ? to.slice(0, 1_000) : "");
  if (!result.ok) return result;
  return { ok: true, data: undefined, message: describeTestSend(result) };
}

/* ------------------------------------------------------------------ */
/* Sending                                                             */
/* ------------------------------------------------------------------ */

/** Queue the first batches right away, so the page shows progress when it reloads. */
async function runSoon(): Promise<void> {
  try {
    await runComms({ wait: true });
  } catch (error) {
    console.error("[broadcasts] run failed:", error instanceof Error ? error.message : String(error));
  }
}

export async function sendBroadcastAction(id: string, rate: number): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await startBroadcast(String(id), { rate });
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.send", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject, recipients: result.broadcast.recipients });
  await runSoon();
  revalidatePath("/admin/broadcasts", "layout");
  const n = result.broadcast.recipients;
  return { ok: true, data: undefined, message: `Sending to ${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}` };
}

export async function scheduleBroadcastAction(id: string, at: string, rate: number): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await scheduleBroadcast(String(id), at, rate);
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.schedule", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject, scheduledAt: result.broadcast.scheduledAt ?? "" });
  // Arms the runner's timer for the scheduled time.
  await runSoon();
  revalidatePath("/admin/broadcasts", "layout");
  return { ok: true, data: undefined, message: "Broadcast scheduled" };
}

export async function unscheduleBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await unscheduleBroadcast(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.unschedule", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject });
  revalidatePath("/admin/broadcasts", "layout");
  return { ok: true, data: undefined, message: "Schedule cancelled. The broadcast is a draft again." };
}

export async function pauseBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await pauseBroadcast(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.pause", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject });
  revalidatePath("/admin/broadcasts", "layout");
  return { ok: true, data: undefined, message: "Sending paused" };
}

export async function resumeBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await resumeBroadcast(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.resume", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject });
  await runSoon();
  revalidatePath("/admin/broadcasts", "layout");
  return { ok: true, data: undefined, message: "Sending resumed" };
}

export async function cancelBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await cancelBroadcast(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.cancel", { type: "broadcast", id: result.broadcast.id }, {
    subject: result.broadcast.subject,
    queued: result.broadcast.queued ?? 0,
    recipients: result.broadcast.recipients,
  });
  revalidatePath("/admin/broadcasts", "layout");
  return { ok: true, data: undefined, message: "Sending stopped" };
}

/** Copy a broadcast into a new draft and open it in the composer. */
export async function duplicateBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await duplicateBroadcast(user, String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.create", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject, copiedFrom: String(id) });
  revalidatePath("/admin/broadcasts", "layout");
  await setFlash("Copied to a new draft");
  redirect(`/admin/broadcasts/${result.broadcast.id}/edit`);
}

export async function deleteBroadcastAction(id: string): Promise<ActionResult> {
  const user = await broadcastStaff();
  if (!user) return { ok: false, error: STAFF_ONLY };
  const result = await deleteBroadcast(String(id));
  if (!result.ok) return { ok: false, error: result.error };
  await audit(user, "broadcast.delete", { type: "broadcast", id: result.broadcast.id }, { subject: result.broadcast.subject, status: result.broadcast.status });
  revalidatePath("/admin/broadcasts", "layout");
  await setFlash("Broadcast deleted");
  redirect("/admin/broadcasts");
}
