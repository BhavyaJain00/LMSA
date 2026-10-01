"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, getSettings, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { fd, fdBool } from "@/lib/utils";
import { parseCategorySeo, parseSeoSettings } from "@/lib/seo/settings";
import { buildContentIndex, categoryPath } from "@/lib/seo/content-index";
import { publishRedirectFile, rowsFromRules, rulesFromRows, syncContentIndex } from "@/lib/seo/content-sync";
import { describeIndexNowResult, generateIndexNowKey, isValidIndexNowKey } from "@/lib/seo/indexnow";
import { submitToIndexNow } from "@/lib/seo/indexnow-client";
import { addRedirect, redirectKey, validateManualRedirect } from "@/lib/seo/redirects";
import { siteOrigin } from "@/lib/seo/site";
import { buildSitemap } from "@/lib/seo/sitemap";

const ADMIN_ONLY = "Only administrators can change SEO settings.";

async function requireAdmin(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

/**
 * Admin → Settings → SEO: title template, default description and share
 * image, X handle, the Organization used in structured data, search engine
 * verification tokens and the site-wide noindex switch. Admin only; every
 * page's metadata is rebuilt from these values, so the whole layout is
 * revalidated.
 */
export async function saveSeoSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };

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
  const blogEnabled = fdBool(formData, "blogEnabled");
  await mutate((db) => {
    Object.assign(db.settings.brand, patch.brand);
    Object.assign(db.settings.seo, patch.seo);
    db.settings.seo.blogEnabled = blogEnabled;
    db.settings.updatedAt = new Date().toISOString();
  });
  await audit(user, "settings.update", { type: "settings", id: "seo" }, { section: "seo", noindexSite: patch.seo.noindexSite, noindexChanged: before !== patch.seo.noindexSite, blogEnabled });
  revalidatePath("/", "layout");
  return {
    ok: true,
    data: undefined,
    message: patch.seo.noindexSite ? "SEO settings saved. Search engines are asked not to index the site." : "SEO settings saved",
  };
}

/* ------------------------------------------------------------------ */
/* IndexNow                                                            */
/* ------------------------------------------------------------------ */

/**
 * Set the IndexNow key: a pasted key (moving a site that already has one) or,
 * with an empty field, a newly generated one. The key file is served from the
 * new key immediately, so nothing else has to be deployed.
 */
export async function saveIndexNowKeyAction(_prev: ActionResult<{ key: string }> | null, formData: FormData): Promise<ActionResult<{ key: string }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const typed = fd(formData, "indexNowKey");
  if (typed && !isValidIndexNowKey(typed)) {
    const error = "A key is 8 to 128 letters, digits or dashes.";
    return { ok: false, error, fieldErrors: { indexNowKey: error } };
  }
  const key = typed || generateIndexNowKey();
  await mutate((db) => {
    db.settings.seo.indexNowKey = key;
    db.settings.updatedAt = new Date().toISOString();
  });
  await audit(user, "seo.indexnow_key", { type: "settings", id: "seo" }, { generated: !typed });
  revalidatePath("/admin/settings/seo", "layout");
  return { ok: true, data: { key }, message: typed ? "IndexNow key saved" : "New IndexNow key generated" };
}

/** Send every address of the sitemap to IndexNow (after a launch, a migration or a domain change). */
export async function submitSitemapToIndexNowAction(): Promise<ActionResult<{ submitted: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const urls = buildSitemap(await getDb(), siteOrigin()).map((entry) => entry.url);
  if (!urls.length) return { ok: false, error: "There are no public pages to submit yet." };
  const result = await submitToIndexNow(urls, { force: true });
  await audit(user, "seo.indexnow_submit", { type: "settings", id: "seo" }, { urls: urls.length, submitted: result.submitted, ok: result.ok });
  revalidatePath("/admin/settings/seo", "layout");
  const summary = describeIndexNowResult(result);
  return summary.ok ? { ok: true, data: { submitted: result.submitted }, message: summary.text } : { ok: false, error: summary.text };
}

/** Detect renamed and newly published pages right now instead of waiting for the next page view. */
export async function syncContentNowAction(): Promise<ActionResult<{ redirectsAdded: number; submitted: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const outcome = await syncContentIndex({ force: true });
  revalidatePath("/admin/settings/seo", "layout");
  const parts = [
    outcome.redirectsAdded ? `${outcome.redirectsAdded} redirect${outcome.redirectsAdded === 1 ? "" : "s"} added` : "",
    outcome.submitted ? `${outcome.submitted} address${outcome.submitted === 1 ? "" : "es"} sent to search engines` : "",
  ].filter(Boolean);
  return { ok: true, data: outcome, message: parts.length ? parts.join(" · ") : "Everything is up to date" };
}

/* ------------------------------------------------------------------ */
/* Redirects                                                           */
/* ------------------------------------------------------------------ */

/** Add a permanent redirect by hand (a retired page, a campaign address, a URL from an older site). */
export async function addRedirectAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const db = await getDb();
  const livePaths = Object.values(buildContentIndex(db)).map((entry) => entry.path);
  const checked = validateManualRedirect(fd(formData, "fromPath"), fd(formData, "toPath"), { origin: siteOrigin(), livePaths });
  if (!checked.ok) return { ok: false, error: checked.errors.fromPath ?? checked.errors.toPath ?? "Check both addresses.", fieldErrors: checked.errors };

  const nowIso = new Date().toISOString();
  await mutate((d) => {
    d.slugRedirects = rowsFromRules(addRedirect(rulesFromRows(d.slugRedirects), checked.from, checked.to), d.slugRedirects, nowIso);
  });
  await publishRedirectFile();
  await audit(user, "seo.redirect_add", { type: "redirect", id: checked.from }, { from: checked.from, to: checked.to });
  revalidatePath("/admin/settings/seo", "layout");
  return { ok: true, data: undefined, message: `${checked.from} now redirects to ${checked.to}` };
}

/** Remove redirects: the old addresses answer "not found" again (or show whatever page now lives there). */
export async function deleteRedirectsAction(ids: string[]): Promise<ActionResult<{ removed: number }>> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: ADMIN_ONLY };
  const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id): id is string => typeof id === "string").slice(0, 1000));
  if (!wanted.size) return { ok: false, error: "Select at least one redirect." };
  const removed = await mutate((d) => {
    const gone = d.slugRedirects.filter((r) => wanted.has(r.id));
    if (gone.length) d.slugRedirects = d.slugRedirects.filter((r) => !wanted.has(r.id));
    return gone.map((r) => redirectKey(r.fromPath));
  });
  if (!removed.length) return { ok: false, error: "These redirects no longer exist." };
  await publishRedirectFile();
  await audit(user, "seo.redirect_delete", { type: "redirect", id: removed[0]! }, { count: removed.length, from: removed.slice(0, 20).join(", ") });
  revalidatePath("/admin/settings/seo", "layout");
  return { ok: true, data: { removed: removed.length }, message: removed.length === 1 ? "Redirect removed" : `${removed.length} redirects removed` };
}

/* ------------------------------------------------------------------ */
/* Category landing pages                                              */
/* ------------------------------------------------------------------ */

/** Introduction and search snippet of a category landing page (`/courses/category/<slug>`). */
export async function saveCategorySeoAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return { ok: false, error: "Only administrators can manage categories." };
  const id = fd(formData, "id");
  const { patch, errors } = parseCategorySeo({ intro: fd(formData, "intro"), seoTitle: fd(formData, "seoTitle"), seoDescription: fd(formData, "seoDescription") });
  if (Object.keys(errors).length) return { ok: false, error: Object.values(errors)[0]!, fieldErrors: errors };
  const saved = await mutate((db) => {
    const row = db.categories.find((c) => c.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return { name: row.name, slug: row.slug };
  });
  if (!saved) return { ok: false, error: "This category no longer exists." };
  await audit(user, "category.landing_update", { type: "category", id }, { name: saved.name, introLength: (patch.intro ?? "").length });
  revalidatePath("/admin/settings/categories");
  revalidatePath(categoryPath(saved.slug));
  return { ok: true, data: undefined, message: "Landing page saved" };
}
