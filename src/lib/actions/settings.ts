"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult, Settings, SidebarItem } from "@/lib/types";
import { createSession, getCurrentUser, isAdmin } from "@/lib/auth/session";
import { buildDemoData, getDb, mutate } from "@/lib/db/store";
import { getBackupManager } from "@/lib/db/backup";
import { backupActorLabel } from "@/lib/db/backup-admin";
import { Icon } from "@/components/ui/icons";
import { setFlash } from "@/lib/flash";
import { audit } from "@/lib/audit";
import { fd, fdBool, isValidEmail, isValidUrl, uid } from "@/lib/utils";

/**
 * Admin settings (Frappe: LMS Settings + Website Settings). Every action is
 * admin-only, writes `db.settings` through `mutate` and revalidates the whole
 * layout so branding, navigation and feature toggles update everywhere.
 */

type Errors = Record<string, string>;

async function requireAdmin() {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

const DENIED: ActionResult = { ok: false, error: "Only administrators can change site settings." };

function fail(errors: Errors): ActionResult {
  return { ok: false, error: Object.values(errors)[0] ?? "Please fix the errors below.", fieldErrors: errors };
}

/** Apply a settings change, audit it as `settings.update` for `section`, and refresh every page. */
async function commit(fn: (s: Settings) => void, message: string, section: string): Promise<ActionResult> {
  await mutate((db) => {
    fn(db.settings);
    db.settings.updatedAt = new Date().toISOString();
  });
  await audit(await getCurrentUser(), "settings.update", { type: "settings", id: section }, { section });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined, message };
}

function isAssetUrl(value: string): boolean {
  return value.startsWith("/") ? !value.startsWith("//") : isValidUrl(value);
}

/* ------------------------------------------------------------------ */
/* General                                                             */
/* ------------------------------------------------------------------ */

export async function saveGeneralSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const name = fd(formData, "name");
  const tagline = fd(formData, "tagline");
  const footerText = fd(formData, "footerText");
  const contactEmail = fd(formData, "contactEmail");
  const contactUrl = fd(formData, "contactUrl");
  const textDirection = fd(formData, "textDirection");

  const errors: Errors = {};
  if (!name) errors.name = "Brand name is required";
  else if (name.length > 60) errors.name = "Keep the brand name under 60 characters.";
  if (tagline.length > 140) errors.tagline = "Keep the tagline under 140 characters.";
  if (footerText.length > 300) errors.footerText = "Keep the footer text under 300 characters.";
  if (contactEmail && !isValidEmail(contactEmail)) errors.contactEmail = "Please enter a valid email address.";
  if (contactUrl && !/^https?:\/\//i.test(contactUrl)) errors.contactUrl = "The contact URL must start with http:// or https://";
  else if (contactUrl && !isValidUrl(contactUrl)) errors.contactUrl = "Please enter a valid URL.";
  if (textDirection !== "auto" && textDirection !== "ltr" && textDirection !== "rtl") errors.textDirection = "Choose a text direction.";
  if (Object.keys(errors).length) return fail(errors);

  return commit((s) => {
    s.brand.name = name;
    s.brand.tagline = tagline;
    s.brand.footerText = footerText;
    s.contact.email = contactEmail || undefined;
    s.contact.url = contactUrl || undefined;
    s.textDirection = textDirection as Settings["textDirection"];
  }, "General settings saved", "general");
}

/* ------------------------------------------------------------------ */
/* Branding                                                            */
/* ------------------------------------------------------------------ */

function normalizeHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

export async function saveBrandingSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const logoUrl = fd(formData, "logoUrl");
  const faviconUrl = fd(formData, "faviconUrl");
  const accent = normalizeHex(fd(formData, "accentColor"));

  const errors: Errors = {};
  if (logoUrl && !isAssetUrl(logoUrl)) errors.logoUrl = "Upload an image or enter a valid URL.";
  if (faviconUrl && !isAssetUrl(faviconUrl)) errors.faviconUrl = "Upload an image or enter a valid URL.";
  if (!accent) errors.accentColor = "Enter a hex color such as #4f46e5.";
  if (Object.keys(errors).length || !accent) return fail(errors);

  return commit((s) => {
    s.brand.logoUrl = logoUrl || undefined;
    s.brand.faviconUrl = faviconUrl || undefined;
    s.brand.accentColor = accent;
  }, "Branding saved", "branding");
}

// SEO settings are saved by saveSeoSettingsAction in ./seo-settings.ts.

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

export async function saveFeatureSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const db = await getDb();
  const keys = Object.keys(db.settings.features) as (keyof Settings["features"])[];
  return commit((s) => {
    for (const key of keys) s.features[key] = fdBool(formData, key);
  }, "Features updated", "features");
}

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */

const NOTIFY_OPTIONS = ["none", "email", "in_app"] as const;

export async function saveLearningSettingsAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const dwell = Number(fd(formData, "lessonDwellTimeSeconds"));
  const threshold = Number(fd(formData, "videoCompletionThreshold"));
  const defaultHome = fd(formData, "defaultHome");
  const notifyCourses = fd(formData, "notifyOnPublishedCourses");
  const notifyBatches = fd(formData, "notifyOnPublishedBatches");
  const customSignupContent = fd(formData, "customSignupContent");

  const errors: Errors = {};
  if (!Number.isInteger(dwell) || dwell < 1) errors.lessonDwellTimeSeconds = "Lesson Dwell Time must be at least 1 second.";
  else if (dwell > 3600) errors.lessonDwellTimeSeconds = "Lesson Dwell Time cannot exceed one hour (3600 seconds).";
  if (!Number.isFinite(threshold) || threshold < 1 || threshold > 100) errors.videoCompletionThreshold = "Enter a percentage between 1 and 100.";
  if (defaultHome !== "courses" && defaultHome !== "dashboard") errors.defaultHome = "Choose a default home page.";
  if (!(NOTIFY_OPTIONS as readonly string[]).includes(notifyCourses)) errors.notifyOnPublishedCourses = "Choose how members are notified.";
  if (!(NOTIFY_OPTIONS as readonly string[]).includes(notifyBatches)) errors.notifyOnPublishedBatches = "Choose how members are notified.";
  if (customSignupContent.length > 5000) errors.customSignupContent = "Keep the signup content under 5,000 characters.";
  if (Object.keys(errors).length) return fail(errors);

  return commit((s) => {
    s.learning.allowGuestAccess = fdBool(formData, "allowGuestAccess");
    s.learning.disableSignup = fdBool(formData, "disableSignup");
    s.learning.lessonDwellTimeSeconds = dwell;
    s.learning.enforceVideoCompletion = fdBool(formData, "enforceVideoCompletion");
    s.learning.enforceQuizCompletion = fdBool(formData, "enforceQuizCompletion");
    s.learning.enforceAssignmentCompletion = fdBool(formData, "enforceAssignmentCompletion");
    s.learning.preventSkippingVideos = fdBool(formData, "preventSkippingVideos");
    s.learning.videoCompletionThreshold = Math.round(threshold);
    s.learning.defaultHome = defaultHome as Settings["learning"]["defaultHome"];
    s.learning.notifyOnPublishedCourses = notifyCourses as Settings["learning"]["notifyOnPublishedCourses"];
    s.learning.notifyOnPublishedBatches = notifyBatches as Settings["learning"]["notifyOnPublishedBatches"];
    s.customSignupContent = customSignupContent || undefined;
  }, "Learning settings saved", "learning");
}

/* ------------------------------------------------------------------ */
/* Sidebar links                                                       */
/* ------------------------------------------------------------------ */

function validateHref(href: string): string | null {
  if (!href) return "Link target is required";
  if (href.startsWith("/")) {
    if (href.startsWith("//")) return "Routes must start with a single '/'.";
    if (/\s/.test(href)) return "Routes cannot contain spaces.";
    return null;
  }
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(href)) return null;
  if (!/^https?:\/\//i.test(href) || !isValidUrl(href)) return "External links must start with http:// or https://";
  return null;
}

function renumber(items: SidebarItem[]): SidebarItem[] {
  return [...items].sort((a, b) => a.order - b.order).map((item, i) => ({ ...item, order: i + 1 }));
}

export async function saveSidebarItemAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const db = await getDb();
  const id = fd(formData, "id");
  const existing = id ? db.settings.sidebarItems.find((s) => s.id === id) : null;
  if (id && !existing) return { ok: false, error: "This sidebar link no longer exists." };
  const label = fd(formData, "label");
  const href = fd(formData, "href");
  const icon = fd(formData, "icon");

  const errors: Errors = {};
  if (!label) errors.label = "Label is required";
  else if (label.length > 40) errors.label = "Keep the label under 40 characters.";
  const hrefError = validateHref(href);
  if (hrefError) errors.href = hrefError;
  if (!icon) errors.icon = "Choose an icon for this link.";
  else if (!(icon in Icon)) errors.icon = "Choose an icon from the list.";
  if (Object.keys(errors).length) return fail(errors);

  return commit(
    (s) => {
      if (existing) {
        s.sidebarItems = s.sidebarItems.map((item) => (item.id === existing.id ? { ...item, label, href, icon } : item));
      } else {
        const order = s.sidebarItems.reduce((max, item) => Math.max(max, item.order), 0) + 1;
        s.sidebarItems = [...s.sidebarItems, { id: uid("sbi"), label, href, icon, order }];
      }
      s.sidebarItems = renumber(s.sidebarItems);
    },
    existing ? "Sidebar link updated" : "Link added to sidebar",
    "sidebar",
  );
}

export async function deleteSidebarItemAction(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const db = await getDb();
  if (!db.settings.sidebarItems.some((s) => s.id === id)) return { ok: false, error: "This sidebar link no longer exists." };
  return commit((s) => {
    s.sidebarItems = renumber(s.sidebarItems.filter((item) => item.id !== id));
  }, "Sidebar link removed", "sidebar");
}

export async function moveSidebarItemAction(id: string, direction: "up" | "down"): Promise<ActionResult> {
  if (!(await requireAdmin())) return DENIED;
  const db = await getDb();
  const sorted = renumber(db.settings.sidebarItems);
  const index = sorted.findIndex((s) => s.id === id);
  if (index === -1) return { ok: false, error: "This sidebar link no longer exists." };
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= sorted.length) return { ok: true, data: undefined };
  const a = sorted[index]!;
  const b = sorted[target]!;
  sorted[index] = { ...b, order: a.order };
  sorted[target] = { ...a, order: b.order };
  return commit((s) => {
    s.sidebarItems = renumber(sorted);
  }, "Sidebar order saved", "sidebar");
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

/** Replace every record with fresh demo data (typed confirmation required). */
export async function resetDemoDataAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const actor = await requireAdmin();
  if (!actor) return DENIED;
  if (fd(formData, "confirm") !== "RESET") {
    return { ok: false, error: "Type RESET to confirm.", fieldErrors: { confirm: "Type RESET (in capitals) to confirm." } };
  }
  // The safety backup and the reset run as one exclusive step (as in reloadDemoDataAction), so the reset can be undone with Restore.
  const demo = await buildDemoData();
  const manager = await getBackupManager();
  const safety = await manager.replaceWith(demo, { source: "demo-reset", reason: "Before reloading the demo data", createdBy: backupActorLabel(actor) });
  await audit(actor, "data.reset", { type: "settings", id: "data" }, { safetyBackup: safety.name });
  revalidatePath("/", "layout");
  // Sessions are wiped by the reset. Keep the admin signed in when their account exists in the demo data.
  const db = await getDb();
  const stillExists = db.users.some((u) => u.id === actor.id && u.enabled);
  if (stillExists) {
    await createSession(actor.id);
    await setFlash("Demo data reloaded", "success");
    redirect("/admin/settings/data");
  }
  await setFlash("Demo data reloaded. Log in with a demo account (password: password123).", "info");
  redirect("/login");
}
