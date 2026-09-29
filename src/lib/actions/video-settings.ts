"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Settings } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { VIDEO_SETTINGS_LIMITS } from "@/lib/media/video-settings";
import { fd, fdBool } from "@/lib/utils";

/**
 * Admin → Settings → Video: protected uploads (signed, expiring URLs),
 * viewer watermark, seek-bar previews and autoplay of the next lesson.
 */

export async function saveVideoSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change site settings." };

  const rawOpacity = fd(formData, "watermarkOpacity");
  const rawMinutes = fd(formData, "signedUrlMinutes");
  // The opacity slider submits a fraction; accept a percentage typed by hand too (e.g. "18").
  let opacity = Number(rawOpacity);
  if (Number.isFinite(opacity) && opacity > 1) opacity = opacity / 100;
  const minutes = Number(rawMinutes);

  const errors: Record<string, string> = {};
  const { watermarkOpacity: o, signedUrlMinutes: m } = VIDEO_SETTINGS_LIMITS;
  if (!rawOpacity || !Number.isFinite(opacity) || opacity < o.min || opacity > o.max) {
    errors.watermarkOpacity = `Choose a watermark opacity between ${Math.round(o.min * 100)}% and ${Math.round(o.max * 100)}%.`;
  }
  if (!rawMinutes || !Number.isInteger(minutes) || minutes < m.min || minutes > m.max) {
    errors.signedUrlMinutes = `Enter a whole number of minutes between ${m.min} and ${m.max}.`;
  }
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const next: Settings["video"] = {
    protectUploads: fdBool(formData, "protectUploads"),
    signedUrlMinutes: minutes,
    watermark: fdBool(formData, "watermark"),
    watermarkOpacity: Math.round(opacity * 100) / 100,
    seekThumbnails: fdBool(formData, "seekThumbnails"),
    autoplayNext: fdBool(formData, "autoplayNext"),
  };

  await mutate((db) => {
    db.settings.video = next;
    db.settings.updatedAt = new Date().toISOString();
  });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message: "Video settings saved" };
}
