import Link from "next/link";
import { cn } from "@/lib/utils";
import { breadcrumbJsonLd, type BreadcrumbItem } from "@/lib/seo/jsonld";
import { normalizeTrail } from "@/lib/seo/breadcrumbs";
import { siteOrigin } from "@/lib/seo/site";
import { Icon } from "@/components/ui/icons";
import { JsonLd } from "./json-ld";

/**
 * Visible breadcrumb trail for public pages plus the matching BreadcrumbList
 * JSON-LD (built from the same items, so the markup always matches what
 * visitors see). Build trails with the helpers in `@/lib/seo/breadcrumbs`.
 * On narrow screens every crumb but the last is capped so the trail wraps
 * instead of overflowing.
 */
export function Breadcrumbs({ items, className, structuredData = true }: { items: BreadcrumbItem[]; className?: string; structuredData?: boolean }) {
  const trail = normalizeTrail(items);
  if (trail.length < 2) return null;
  return (
    <>
      <nav aria-label="Breadcrumb" className={cn("mb-3 min-w-0", className)}>
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-ink-muted">
          {trail.map((item, i) => {
            const last = i === trail.length - 1;
            return (
              <li key={`${i}-${item.name}`} className={cn("flex min-w-0 items-center gap-1", last ? "max-w-full" : "max-w-[45vw] sm:max-w-xs")}>
                {last ? (
                  <span aria-current="page" className="truncate font-medium text-ink">
                    {item.name}
                  </span>
                ) : item.path ? (
                  <Link href={item.path} className="truncate rounded-sm hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                    {item.name}
                  </Link>
                ) : (
                  <span className="truncate">{item.name}</span>
                )}
                {!last && <Icon.ChevronRight className="size-3.5 shrink-0 text-ink-faint" aria-hidden="true" />}
              </li>
            );
          })}
        </ol>
      </nav>
      {structuredData && <JsonLd data={breadcrumbJsonLd(trail, { origin: siteOrigin() })} />}
    </>
  );
}
