import Link from "next/link";
import { cn } from "@/lib/utils";

const LINK = "rounded-lg border border-border-strong px-3 py-1.5 font-medium text-ink outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60";
const DISABLED = "rounded-lg border border-border px-3 py-1.5 text-ink-faint";

/**
 * Previous / next navigation for a URL-driven list (bundles, payment plans).
 * Renders nothing for a single page. `hrefFor` builds the URL of a page with
 * the list's current filters.
 */
export function Pager({
  page,
  pageCount,
  hrefFor,
  label,
  summary,
  className,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
  /** Accessible name of the navigation, e.g. "Bundle pages". */
  label: string;
  /** Text next to the page position, e.g. "42 bundles". */
  summary?: string;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label={label} className={cn("flex items-center justify-between gap-3 text-sm", className)}>
      <p className="text-ink-muted">
        Page {page} of {pageCount}
        {summary ? ` · ${summary}` : ""}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} scroll={false} rel="prev" className={LINK}>
            Previous
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            Previous
          </span>
        )}
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} scroll={false} rel="next" className={LINK}>
            Next
          </Link>
        ) : (
          <span className={DISABLED} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
