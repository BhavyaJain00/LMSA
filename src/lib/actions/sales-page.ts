"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { ActionResult } from "@/lib/types";
import { getCurrentUser } from "@/lib/auth/session";
import { getDb, mutate } from "@/lib/db/store";
import { audit } from "@/lib/audit";
import { canManageCourse } from "@/lib/data/courses";
import { normalizeSalesPage, parseSalesSeo, hasSalesPage } from "@/lib/seo/sales-page";
import { syncContentIndex } from "@/lib/seo/content-sync";
import { coursePath } from "@/lib/seo/content-index";
import { fd } from "@/lib/utils";

/**
 * Course sales page builder (round 3). Course managers (instructors of the
 * course, moderators, admins) save the hero, the ordered sections,
 * testimonials, FAQ, guarantee and countdown, plus the page's SEO title,
 * meta description and share image. Every action re-checks the permission on
 * the course. A public course is re-submitted to IndexNow after a change.
 */

const NOT_ALLOWED = "You don't have permission to edit this course's sales page.";
const MAX_JSON = 200_000;

function afterChange(slug: string, courseId: string): void {
  revalidatePath(coursePath(slug));
  revalidatePath(`/admin/courses/${courseId}/sales-page`);
  try {
    after(() => syncContentIndex({ force: true }));
  } catch {
    // Outside a request (tests): run the sync now.
    void syncContentIndex({ force: true });
  }
}

async function manageableCourse(courseId: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: NOT_ALLOWED } as const;
  const course = (await getDb()).courses.find((c) => c.id === courseId);
  if (!course) return { ok: false, error: "This course no longer exists." } as const;
  if (!canManageCourse(user, course)) return { ok: false, error: NOT_ALLOWED } as const;
  return { ok: true, user, course } as const;
}

/** Save the builder: `courseId`, `page` (JSON of the sales page), `seoTitle`, `metaDescription`, `ogImageUrl`. */
export async function saveSalesPageAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const found = await manageableCourse(fd(formData, "courseId"));
  if (!found.ok) return { ok: false, error: found.error };
  const { user, course } = found;

  const json = formData.get("page");
  if (typeof json !== "string" || json.length > MAX_JSON) return { ok: false, error: "The sales page is too large to save. Shorten some sections." };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "The sales page could not be read. Reload the page and try again." };
  }
  const { page, errors } = normalizeSalesPage(raw);
  const seo = parseSalesSeo({ seoTitle: fd(formData, "seoTitle"), metaDescription: fd(formData, "metaDescription"), ogImageUrl: fd(formData, "ogImageUrl") });
  const fieldErrors = { ...errors, ...seo.errors };
  if (Object.keys(fieldErrors).length) return { ok: false, error: Object.values(fieldErrors)[0]!, fieldErrors };

  const now = new Date().toISOString();
  await mutate((db) => {
    const row = db.courses.find((c) => c.id === course.id);
    if (!row) return;
    row.salesPage = page;
    row.seoTitle = seo.patch.seoTitle;
    row.metaDescription = seo.patch.metaDescription;
    row.ogImageUrl = seo.patch.ogImageUrl;
    row.updatedAt = now;
  });
  await audit(user, "course.sales_page.update", { type: "course", id: course.id }, { sections: page.sections.length, faq: page.faq.length, testimonials: page.testimonials.length, countdown: !!page.countdownEndsAt });
  afterChange(course.slug, course.id);
  return {
    ok: true,
    data: undefined,
    message: hasSalesPage(page) ? "Sales page saved" : "Saved. Add a headline or a section to replace the standard course layout.",
  };
}

/** Remove the sales page: the course page goes back to the standard layout (SEO fields are kept). */
export async function removeSalesPageAction(courseId: string): Promise<ActionResult> {
  const found = await manageableCourse(courseId);
  if (!found.ok) return { ok: false, error: found.error };
  const { user, course } = found;
  if (!course.salesPage) return { ok: true, data: undefined, message: "This course has no sales page." };
  await mutate((db) => {
    const row = db.courses.find((c) => c.id === course.id);
    if (!row) return;
    row.salesPage = undefined;
    row.updatedAt = new Date().toISOString();
  });
  await audit(user, "course.sales_page.remove", { type: "course", id: course.id });
  afterChange(course.slug, course.id);
  return { ok: true, data: undefined, message: "Sales page removed. The course page uses the standard layout again." };
}
