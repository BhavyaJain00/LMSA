import Link from "next/link";
import { LANDING_SORTS, type LandingSort, landingHref } from "@/lib/seo/landing";
import { cn } from "@/lib/utils";

/**
 * Sort order of a landing page's course list as plain links (works without
 * JavaScript; the default order is the bare canonical URL, the others are
 * kept out of the index by the page's metadata). Server Component.
 */
export function SortLinks({ base, current, className }: { base: string; current: LandingSort; className?: string }) {
  return (
    <nav aria-label="Sort courses" className={cn("no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1", className)}>
      {LANDING_SORTS.map((sort) => {
        const active = sort.value === current;
        return (
          <Link
            key={sort.value}
            href={landingHref(base, { sort: sort.value })}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2 hover:text-ink",
            )}
          >
            {sort.label}
          </Link>
        );
      })}
    </nav>
  );
}
