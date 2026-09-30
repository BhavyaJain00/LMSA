"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, SegmentFilter, User } from "@/lib/types";
import { getCurrentUser, isAdmin, isModerator } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fdBool } from "@/lib/utils";
import { cleanSegmentFilter, previewSegment, type SegmentPreview } from "@/lib/comms/audience";

/**
 * Broadcast administration (moderators and admins): audience segments and
 * email tracking settings. Every action re-checks the caller's role.
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
