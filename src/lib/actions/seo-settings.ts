"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getSettings, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fd, fdBool } from "@/lib/utils";
import { parseSeoSettings } from "@/lib/seo/settings";

/**
 * Admin → Settings → SEO: title template, default description and share
 * image, X handle, the Organization used in structured data, search engine
 * verification tokens and the site-wide noindex switch. Admin only; every
 * page's metadata is rebuilt from these values, so the whole layout is
 * revalidated.
 */
export async function saveSeoSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Only administrators can change SEO settings." };

  const { patch, errors } = parseSeoSettings({
    siteTitleTemplate: fd(formData, "siteTitleTemplate"),
    metaDescription: fd(formData, "metaDescription"),
    metaKeywords: fd(formData, "metaKeywords"),
    metaImageUrl: fd(formData, "metaImageUrl"),
    twitterHandle: fd(formData, "twitterHandle"),
    organizationName: fd(formData, "organizationName"),
    organizationLogoUrl: fd(formData, "organizationLogoUrl"),
    sameAs: fd(formData, "sameAs"),
    googleVerification: fd(formData, "googleVerification"),
    bingVerification: fd(formData, "bingVerification"),
    noindexSite: fdBool(formData, "noindexSite"),
  });
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };

  const before = (await getSettings()).seo.noindexSite;
  await mutate((db) => {
    Object.assign(db.settings.brand, patch.brand);
    Object.assign(db.settings.seo, patch.seo);
    db.settings.updatedAt = new Date().toISOString();
  });
  await audit(user, "settings.update", { type: "settings", id: "seo" }, { section: "seo", noindexSite: patch.seo.noindexSite, noindexChanged: before !== patch.seo.noindexSite });
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: undefined,
    message: patch.seo.noindexSite ? "SEO settings saved. Search engines are asked not to index the site." : "SEO settings saved",
  };
}
