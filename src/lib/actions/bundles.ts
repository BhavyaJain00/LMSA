"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult, Bundle, User } from "@/lib/types";
import { getCurrentUser, isAdmin } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { currencies } from "@/lib/config";
import { fd, fdBool, uid, uniqueSlug } from "@/lib/utils";
import { bundleCourses, validateBundleInput } from "@/lib/commerce/bundles";
import { publishRedirectFile, rowsFromRules, rulesFromRows } from "@/lib/seo/content-sync";
import { addRedirect, redirectKey } from "@/lib/seo/redirects";

/**
 * Server Actions for course bundles (administrators): create, edit, publish,
 * duplicate and delete bundles, bulk changes, and the platform switch that
 * puts the bundle pages on sale. Buying a bundle goes through the shared
 * checkout (`placeOrderAction` with item type "bundle").
 */

const bundlePath = (slug: string) => `/bundles/${slug}`;

function revalidateBundles(...slugs: (string | undefined)[]): void {
  revalidatePath("/bundles");
  for (const slug of slugs) if (slug) revalidatePath(bundlePath(slug));
  revalidatePath("/admin/settings/plans");
  // The main menu links to the bundles page while bundles are on sale.
  revalidatePath("/", "layout");
}

async function requireAdminActor(): Promise<User | null> {
  const user = await getCurrentUser();
  return user && isAdmin(user) ? user : null;
}

const NOT_ALLOWED = "Only administrators can manage bundles.";

/**
 * Keep the old address of a renamed bundle working (a permanent redirect
 * served by the proxy), and never redirect away from an address a bundle
 * uses now.
 */
async function syncBundleRedirects(live: string, previous?: string): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const changed = await mutate((d) => {
      const before = rulesFromRows(d.slugRedirects);
      const liveKey = redirectKey(bundlePath(live));
      let rules = before.filter((rule) => redirectKey(rule.from) !== liveKey);
      if (previous && previous !== live) rules = addRedirect(rules, bundlePath(previous), bundlePath(live));
      if (rules.length === before.length && rules.every((rule, i) => rule.from === before[i]!.from && rule.to === before[i]!.to)) return false;
      d.slugRedirects = rowsFromRules(rules, d.slugRedirects, nowIso);
      return true;
    });
    if (changed) await publishRedirectFile();
  } catch (error) {
    console.error("[bundles] could not update the redirects of a renamed bundle:", error instanceof Error ? error.message : String(error));
  }
}

/** Create or update a bundle. */
export async function saveBundleAction(_prev: ActionResult<{ id: string; slug: string }> | null, formData: FormData): Promise<ActionResult<{ id: string; slug: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: NOT_ALLOWED };
  const id = fd(formData, "id");
  const db = await getDb();
  const existing = id ? db.bundles.find((b) => b.id === id) : undefined;
  if (id && !existing) return { ok: false, error: "This bundle no longer exists." };

  const parsed = validateBundleInput(
    {
      title: fd(formData, "title"),
      slug: fd(formData, "slug"),
      description: fd(formData, "description"),
      courseIds: formData.getAll("courseIds").map(String),
      price: fd(formData, "price"),
      currency: fd(formData, "currency"),
      imageUrl: fd(formData, "imageUrl"),
      published: fdBool(formData, "published"),
    },
    { knownCourseIds: new Set(db.courses.map((c) => c.id)), currencies: [...new Set<string>([...currencies, db.settings.commerce.defaultCurrency])] },
  );
  if (!parsed.ok) return { ok: false, error: Object.values(parsed.errors)[0] ?? "Please fix the errors below.", fieldErrors: parsed.errors };
  const draft = parsed.draft;
  if (db.bundles.some((b) => b.slug === draft.slug && b.id !== id)) {
    return { ok: false, error: "Another bundle already uses this URL name.", fieldErrors: { slug: "Already used by another bundle." } };
  }

  const nowIso = new Date().toISOString();
  const bundleId = existing?.id ?? uid("bnd");
  const previousSlug = existing?.slug;
  await mutate((d) => {
    const fields = {
      slug: draft.slug,
      title: draft.title,
      description: draft.description,
      courseIds: draft.courseIds,
      price: draft.price,
      currency: draft.currency,
      imageUrl: draft.imageUrl,
      published: draft.published,
      updatedAt: nowIso,
    } satisfies Partial<Bundle>;
    const row = d.bundles.find((b) => b.id === bundleId);
    if (row) {
      // Fixed prices in other currencies belong to the old price: they are dropped when it changes.
      if (row.price !== draft.price || row.currency !== draft.currency) row.prices = undefined;
      Object.assign(row, fields);
    } else d.bundles.push({ id: bundleId, ...fields, createdAt: nowIso });
  });
  await syncBundleRedirects(draft.slug, previousSlug);
  await audit(actor, existing ? "bundle.update" : "bundle.create", { type: "bundle", id: bundleId }, { title: draft.title, price: draft.price, currency: draft.currency, courses: draft.courseIds.length, published: draft.published });
  revalidateBundles(draft.slug, previousSlug);

  const live = bundleCourses({ courseIds: draft.courseIds }, db.courses).filter((c) => c.published).length;
  const note = draft.published && live === 0 ? " None of its courses is published yet, so it stays hidden until one is." : "";
  return { ok: true, data: { id: bundleId, slug: draft.slug }, message: `${existing ? "Bundle saved." : "Bundle created."}${note}` };
}

export type BundleBulkOp = "publish" | "unpublish" | "delete";

/**
 * Publish, unpublish or delete bundles. Bundles that were ordered are kept
 * (their orders and invoices refer to them): they can only be unpublished.
 */
export async function bundlesAction(bundleIds: string[], op: BundleBulkOp): Promise<ActionResult<{ changed: number; kept: number }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: NOT_ALLOWED };
  const ids = Array.isArray(bundleIds) ? [...new Set(bundleIds.filter((id): id is string => typeof id === "string" && !!id))] : [];
  if (!ids.length) return { ok: false, error: "Select at least one bundle." };
  if (op !== "publish" && op !== "unpublish" && op !== "delete") return { ok: false, error: "Unknown action." };

  const nowIso = new Date().toISOString();
  const result = await mutate((d) => {
    const changed: { id: string; slug: string; title: string }[] = [];
    let kept = 0;
    const wanted = new Set(ids);
    if (op === "delete") {
      const ordered = new Set(d.payments.filter((p) => p.itemType === "bundle").map((p) => p.itemId));
      const gifted = new Set(d.gifts.filter((g) => g.itemType === "bundle").map((g) => g.itemId));
      const offered = new Set(d.upsells.flatMap((u) => [u.triggerItemType === "bundle" ? u.triggerItemId : "", u.offerItemType === "bundle" ? u.offerItemId : ""]));
      d.bundles = d.bundles.filter((b) => {
        if (!wanted.has(b.id)) return true;
        if (ordered.has(b.id) || gifted.has(b.id) || offered.has(b.id)) {
          kept++;
          return true;
        }
        changed.push({ id: b.id, slug: b.slug, title: b.title });
        return false;
      });
      return { changed, kept };
    }
    const published = op === "publish";
    for (const b of d.bundles) {
      if (!wanted.has(b.id) || b.published === published) continue;
      b.published = published;
      b.updatedAt = nowIso;
      changed.push({ id: b.id, slug: b.slug, title: b.title });
    }
    return { changed, kept };
  });

  for (const b of result.changed) await audit(actor, `bundle.${op}`, { type: "bundle", id: b.id }, { title: b.title });
  revalidateBundles(...result.changed.map((b) => b.slug));
  const n = result.changed.length;
  const noun = `bundle${n === 1 ? "" : "s"}`;
  if (op === "delete") {
    if (!n) return { ok: false, error: result.kept ? "Bundles with orders, gifts or upsell offers can't be deleted. Unpublish them to stop selling them." : "These bundles no longer exist." };
    return { ok: true, data: { changed: n, kept: result.kept }, message: `${n} ${noun} deleted.${result.kept ? ` ${result.kept} kept because they have orders, gifts or upsell offers.` : ""}` };
  }
  if (!n) return { ok: true, data: { changed: 0, kept: 0 }, message: op === "publish" ? "Already published." : "Already unpublished." };
  return { ok: true, data: { changed: n, kept: 0 }, message: op === "publish" ? `${n} ${noun} published.` : `${n} ${noun} unpublished. Buyers keep their courses.` };
}

/** Copy a bundle as an unpublished draft. */
export async function duplicateBundleAction(bundleId: string): Promise<ActionResult<{ id: string }>> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: NOT_ALLOWED };
  const nowIso = new Date().toISOString();
  const copy = await mutate((d): Bundle | null => {
    const source = d.bundles.find((b) => b.id === bundleId);
    if (!source) return null;
    const row: Bundle = {
      ...source,
      id: uid("bnd"),
      slug: uniqueSlug(`${source.slug}-copy`.slice(0, 76), d.bundles.map((b) => b.slug)),
      title: `${source.title} (copy)`.slice(0, 120),
      courseIds: [...source.courseIds],
      prices: source.prices?.map((p) => ({ ...p })),
      published: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    d.bundles.push(row);
    return { ...row };
  });
  if (!copy) return { ok: false, error: "This bundle no longer exists." };
  await audit(actor, "bundle.duplicate", { type: "bundle", id: copy.id }, { title: copy.title, from: bundleId });
  revalidateBundles();
  return { ok: true, data: { id: copy.id }, message: "Bundle copied as a draft. Edit it and publish when it's ready." };
}

/** Turn bundle sales on or off (the bundle pages, their menu link and new bundle checkouts). Buyers keep their courses. */
export async function setBundlesEnabledAction(enabled: boolean): Promise<ActionResult> {
  const actor = await requireAdminActor();
  if (!actor) return { ok: false, error: "Only administrators can change bundle settings." };
  const on = enabled === true;
  await mutate((d) => {
    d.settings.growth.bundlesEnabled = on;
    d.settings.updatedAt = new Date().toISOString();
  });
  await audit(actor, "settings.update", { type: "settings", id: "growth" }, { bundlesEnabled: on });
  revalidateBundles();
  return { ok: true, data: undefined, message: on ? "Bundles are on sale. The bundles page is live." : "Bundle sales are paused. Buyers keep the courses they bought." };
}
