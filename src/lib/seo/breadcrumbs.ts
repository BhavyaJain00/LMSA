import type { BreadcrumbItem } from "./jsonld";
import { categoryPath } from "./content-index";

/**
 * Breadcrumb trails of the public pages. One definition feeds both the
 * visible `<Breadcrumbs>` navigation and its BreadcrumbList JSON-LD, so the
 * two never disagree (Google requires the markup to match what users see).
 * The last item is the current page and carries no path. Pure.
 */

export const HOME_CRUMB: BreadcrumbItem = { name: "Home", path: "/" };

/** Home → Courses → Category → Course. */
export function courseTrail(course: { title: string }, category: { name: string; slug: string } | null | undefined): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = [HOME_CRUMB, { name: "Courses", path: "/courses" }];
  if (category) items.push({ name: category.name, path: categoryPath(category.slug) });
  items.push({ name: course.title });
  return items;
}

/** Home → Batches → Batch. */
export function batchTrail(batch: { title: string }): BreadcrumbItem[] {
  return [HOME_CRUMB, { name: "Batches", path: "/batches" }, { name: batch.title }];
}

/** Home → Programs → Program. */
export function programTrail(program: { title: string }): BreadcrumbItem[] {
  return [HOME_CRUMB, { name: "Programs", path: "/programs" }, { name: program.title }];
}

/** Home → Jobs → Job. */
export function jobTrail(job: { title: string }): BreadcrumbItem[] {
  return [HOME_CRUMB, { name: "Jobs", path: "/jobs" }, { name: job.title }];
}

/** Home → Legal → Page (the legal hub has no page of its own, so it is not linked). */
export function legalTrail(page: { title: string }): BreadcrumbItem[] {
  return [HOME_CRUMB, { name: "Legal" }, { name: page.title }];
}

/** Home → Verify a certificate → Recipient's certificate. */
export function certificateTrail(title: string): BreadcrumbItem[] {
  return [HOME_CRUMB, { name: "Verify a certificate", path: "/certificates" }, { name: title }];
}

/** Home → Section (for top-level lists: catalog, batches, programs, jobs…). */
export function sectionTrail(name: string): BreadcrumbItem[] {
  return [HOME_CRUMB, { name }];
}

/** Drop nameless items and strip the link from the last item (the current page). */
export function normalizeTrail(items: BreadcrumbItem[]): BreadcrumbItem[] {
  const clean = items.filter((i) => i.name.trim());
  if (!clean.length) return clean;
  const last = clean[clean.length - 1]!;
  return [...clean.slice(0, -1), { name: last.name }];
}
