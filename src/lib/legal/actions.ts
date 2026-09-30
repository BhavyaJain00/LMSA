"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, LegalPage } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { buildSeedLegalPages } from "@/lib/db/seed-round3";
import { audit } from "@/lib/audit";
import { setFlash } from "@/lib/flash";
import { fd, fdBool, isValidEmail, uid } from "@/lib/utils";
import {
  applyLegalPageChange,
  isCoreLegalSlug,
  isValidLegalSlug,
  LEGAL_CONTENT_MAX,
  legalHref,
  validateLegalPageInput,
  validateNewLegalSlug,
  type LegalPageIntent,
} from "./pages-shared";
import { clampRetentionDays, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from "./retention";

/**
 * Admin → Settings → Legal pages: company details, cookie banner, data
 * retention and the legal page editor. Every action is admin-only, audited,
 * and revalidates the whole layout (footer links, cookie banner).
 */

type Errors = Record<string, string>;

const DENIED = { ok: false as const, error: "Only administrators can change legal pages and settings." };
const SETTINGS_PATH = "/admin/settings/legal";

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

function fail(errors: Errors): { ok: false; error: string; fieldErrors: Errors } {
  return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
}

function revalidateLegal(slug?: string) {
  revalidatePath("/", "layout");
  revalidatePath(SETTINGS_PATH);
  if (slug) revalidatePath(legalHref(slug));
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function saveLegalSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const companyName = fd(formData, "companyName");
  const companyAddress = fd(formData, "companyAddress");
  const contactEmail = fd(formData, "contactEmail").toLowerCase();
  const retentionRaw = fd(formData, "dataRetentionDays");
  const cookieBanner = fdBool(formData, "cookieBanner");

  const errors: Errors = {};
  if (!companyName) errors.companyName = "Enter the legal name of the business that runs this site.";
  else if (companyName.length > 120) errors.companyName = "Keep the company name under 120 characters.";
  if (companyAddress.length > 300) errors.companyAddress = "Keep the address under 300 characters.";
  if (contactEmail && !isValidEmail(contactEmail)) errors.contactEmail = "Enter a valid email address.";
  const retention = Number(retentionRaw);
  if (!retentionRaw || !Number.isInteger(retention) || retention < RETENTION_MIN_DAYS || retention > RETENTION_MAX_DAYS) {
    errors.dataRetentionDays = `Enter a whole number of days between ${RETENTION_MIN_DAYS} and ${RETENTION_MAX_DAYS}.`;
  }
  if (Object.keys(errors).length) return fail(errors);

  const before = await mutate((db) => {
    const previous = { ...db.settings.legal };
    db.settings.legal = {
      cookieBanner,
      companyName,
      companyAddress: companyAddress || undefined,
      contactEmail: contactEmail || undefined,
      dataRetentionDays: clampRetentionDays(retention),
    };
    db.settings.updatedAt = new Date().toISOString();
    return previous;
  });
  await audit(user, "settings.update", { type: "settings", id: "legal" }, {
    group: "legal",
    cookieBanner,
    dataRetentionDays: retention,
    retentionChanged: before.dataRetentionDays !== retention,
  });
  revalidateLegal();
  return { ok: true, data: undefined, message: "Legal settings saved" };
}

/* ------------------------------------------------------------------ */
/* Pages                                                               */
/* ------------------------------------------------------------------ */

export interface LegalPageSaveResult {
  slug: string;
  version: number;
  published: boolean;
  updatedAt: string;
  content: string;
}

function starterPage(slug: string, now: Date): LegalPage | null {
  const template = buildSeedLegalPages(now).find((p) => p.slug === slug);
  return template ? { ...template, id: uid("legal"), version: 0 } : null;
}

function readIntent(value: string): LegalPageIntent {
  return value === "publish" || value === "unpublish" ? value : "save";
}

/** Save, publish or unpublish a page from the editor. */
export async function saveLegalPageAction(_prev: ActionResult<LegalPageSaveResult> | null, formData: FormData): Promise<ActionResult<LegalPageSaveResult>> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const slug = fd(formData, "slug");
  const intent = readIntent(fd(formData, "intent"));
  const title = fd(formData, "title");
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.slice(0, LEGAL_CONTENT_MAX + 1) : "";
  if (!isValidLegalSlug(slug)) return { ok: false, error: "This legal page does not exist." };

  const errors = validateLegalPageInput({ title, content }, intent);
  if (Object.keys(errors).length) return fail(errors as Errors);

  const now = new Date();
  const outcome = await mutate((db) => {
    let index = db.legalPages.findIndex((p) => p.slug === slug);
    if (index === -1) {
      if (!isCoreLegalSlug(slug)) return null;
      const starter = starterPage(slug, now);
      if (!starter) return null;
      db.legalPages.push(starter);
      index = db.legalPages.length - 1;
    }
    const current = db.legalPages[index]!;
    const change = applyLegalPageChange(current, { title, content }, intent, now);
    if (!change.unchanged) db.legalPages[index] = change.page;
    return { ...change, wasPublished: current.published };
  });
  if (!outcome) return { ok: false, error: "This legal page no longer exists." };

  const page = outcome.page;
  const data: LegalPageSaveResult = { slug, version: page.version, published: page.published, updatedAt: page.updatedAt, content: page.content };
  if (outcome.unchanged) {
    return { ok: true, data, message: intent === "unpublish" ? "The page is already unpublished." : "No changes to save." };
  }

  const action = outcome.publishedVersion ? "legal.publish" : intent === "unpublish" ? "legal.unpublish" : "legal.save";
  await audit(user, action, { type: "legal_page", id: page.id }, { slug, version: page.version, title: page.title });
  revalidateLegal(slug);

  const message = outcome.publishedVersion
    ? outcome.wasPublished
      ? `Published version ${page.version}. Visitors see the new text now.`
      : `Published. The page is live at ${legalHref(slug)}.`
    : intent === "unpublish"
      ? "Unpublished. The page is hidden from visitors and footer links."
      : "Draft saved. It stays hidden until you publish it.";
  return { ok: true, data, message };
}

/** Create a custom legal page (e.g. an imprint or acceptable-use policy) and open its editor. */
export async function createLegalPageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  const title = fd(formData, "title");
  const slug = fd(formData, "slug").toLowerCase();

  const errors: Errors = {};
  const titleErrors = validateLegalPageInput({ title, content: "" }, "save");
  if (titleErrors.title) errors.title = titleErrors.title;
  const db = await getDb();
  const slugError = validateNewLegalSlug(slug, db.legalPages.map((p) => p.slug));
  if (slugError) errors.slug = slugError;
  if (Object.keys(errors).length) return fail(errors);

  const page: LegalPage = {
    id: uid("legal"),
    slug,
    title,
    content: `# ${title}\n\n`,
    updatedAt: new Date().toISOString(),
    version: 0,
    published: false,
  };
  const created = await mutate((d) => {
    if (d.legalPages.some((p) => p.slug === slug)) return false;
    d.legalPages.push(page);
    return true;
  });
  if (!created) return fail({ slug: "Another legal page already uses this address." });
  await audit(user, "legal.create", { type: "legal_page", id: page.id }, { slug, title });
  revalidateLegal();
  await setFlash("Page created. Write the text, then publish it.");
  redirect(`${SETTINGS_PATH}/${slug}`);
}

/** Delete a custom page. The four standard pages can only be unpublished. */
export async function deleteLegalPageAction(slug: string): Promise<ActionResult> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  if (typeof slug !== "string" || !isValidLegalSlug(slug)) return { ok: false, error: "This legal page does not exist." };
  if (isCoreLegalSlug(slug)) return { ok: false, error: "Standard legal pages can't be deleted. Unpublish it instead." };
  const removed = await mutate((db) => {
    const page = db.legalPages.find((p) => p.slug === slug);
    if (!page) return null;
    db.legalPages = db.legalPages.filter((p) => p.slug !== slug);
    return page;
  });
  if (!removed) return { ok: false, error: "This legal page was already deleted." };
  await audit(user, "legal.delete", { type: "legal_page", id: removed.id }, { slug, title: removed.title, version: removed.version });
  revalidateLegal(slug);
  await setFlash(`“${removed.title}” deleted.`);
  redirect(SETTINGS_PATH);
}

/**
 * Replace a standard page's text with the original starter template. The
 * page is unpublished, since the template must be reviewed again.
 */
export async function restoreLegalTemplateAction(slug: string): Promise<ActionResult<LegalPageSaveResult>> {
  const user = await requireAdmin();
  if (!user) return DENIED;
  if (typeof slug !== "string" || !isCoreLegalSlug(slug)) return { ok: false, error: "Only standard legal pages have a starter template." };
  const now = new Date();
  const template = starterPage(slug, now);
  if (!template) return { ok: false, error: "No template is available for this page." };
  const page = await mutate((db) => {
    const index = db.legalPages.findIndex((p) => p.slug === slug);
    if (index === -1) {
      db.legalPages.push(template);
      return template;
    }
    const current = db.legalPages[index]!;
    const next: LegalPage = { ...current, title: template.title, content: template.content, published: false, updatedAt: now.toISOString() };
    db.legalPages[index] = next;
    return next;
  });
  await audit(user, "legal.restore_template", { type: "legal_page", id: page.id }, { slug });
  revalidateLegal(slug);
  return {
    ok: true,
    data: { slug, version: page.version, published: page.published, updatedAt: page.updatedAt, content: page.content },
    message: "Starter template restored. The page is unpublished until you review and publish it.",
  };
}
