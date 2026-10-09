import { JsonLd } from "@/components/seo/json-ld";
import { normalizeTrail } from "@/lib/seo/breadcrumbs";
import { scheduleContentSync } from "@/lib/seo/content-sync";
import { breadcrumbJsonLd, type BreadcrumbItem } from "@/lib/seo/jsonld";
import { siteOrigin } from "@/lib/seo/site";

/**
 * What `<Breadcrumbs>` does for the course page minus the visible trail (the simple layout shows a back button
 * instead): the BreadcrumbList JSON-LD for public courses, and the content sync every content page schedules
 * (a slug changed in an editor gets its permanent redirect as soon as the page is viewed again).
 */
export function BreadcrumbData({ items, structuredData }: { items: BreadcrumbItem[]; structuredData: boolean }) {
  scheduleContentSync();
  const trail = normalizeTrail(items);
  if (!structuredData || trail.length < 2) return null;
  return <JsonLd data={breadcrumbJsonLd(trail, { origin: siteOrigin() })} />;
}
