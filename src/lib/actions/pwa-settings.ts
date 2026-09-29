"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Settings } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { mutate } from "@/lib/db/store";
import { fdBool } from "@/lib/utils";

/**
 * Admin → Settings → Installable app. Admin-only; writes `settings.pwa` and
 * revalidates the whole layout so the manifest, head tags and service worker
 * registration follow immediately.
 */
export async function savePwaSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change site settings." };
  if (formData.get("section") !== "pwa") return { ok: false, error: "This form is out of date. Reload the page and try again." };

  const enabled = fdBool(formData, "enabled");
  const saved = await mutate((db) => {
    const current = db.settings.pwa;
    // The sub-options are disabled (not submitted) while the app is off: keep their previous values.
    const next: Settings["pwa"] = {
      enabled,
      installPrompt: enabled ? fdBool(formData, "installPrompt") : current.installPrompt,
      offlinePage: enabled ? fdBool(formData, "offlinePage") : current.offlinePage,
    };
    db.settings.pwa = next;
    db.settings.updatedAt = new Date().toISOString();
    return next;
  });

  revalidatePath("/", "layout");
  return {
    ok: true,
    data: undefined,
    message: saved.enabled ? "Installable app settings saved" : "Installable app turned off. Browsers remove it on the next visit.",
  };
}
