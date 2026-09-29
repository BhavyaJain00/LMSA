import Link from "next/link";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** Page numbers to show: first, last, and a window around the current page, with gaps. */
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  const sorted = Array.from(pages)
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}

/**
 * Link-based pagination (works without JavaScript). `hrefFor(page)` builds
 * the URL for a page, keeping the other filters.
 */
export function PageLinks({ page, pageCount, hrefFor, label = "Pagination", className }: { page: number; pageCount: number; hrefFor: (page: number) => string; label?: string; className?: string }) {
  if (pageCount <= 1) return null;
  const itemClass = "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition-colors";
  return (
    <nav aria-label={label} className={cn("flex items-center justify-between gap-2", className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={cn(itemClass, "gap-1 text-ink-muted hover:bg-surface-2 hover:text-ink")} scroll={false}>
          <Icon.ChevronLeft className="size-4 rtl:rotate-180" />
          <span>Previous</span>
        </Link>
      ) : (
        <span className={cn(itemClass, "gap-1 text-ink-faint")} aria-disabled="true">
          <Icon.ChevronLeft className="size-4 rtl:rotate-180" />
          <span>Previous</span>
        </span>
      )}
      <ol className="hidden items-center gap-1 sm:flex">
        {pageWindow(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <li key={`gap-${i}`} className="px-1 text-ink-faint" aria-hidden="true">
              …
            </li>
          ) : (
            <li key={p}>
              <Link
                href={hrefFor(p)}
                scroll={false}
                aria-current={p === page ? "page" : undefined}
                aria-label={`Page ${p}`}
                className={cn(itemClass, p === page ? "bg-ink text-surface-1" : "text-ink-muted hover:bg-surface-2 hover:text-ink")}
              >
                {p}
              </Link>
            </li>
          ),
        )}
      </ol>
      <span className="text-xs text-ink-muted sm:hidden">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={cn(itemClass, "gap-1 text-ink-muted hover:bg-surface-2 hover:text-ink")} scroll={false}>
          <span>Next</span>
          <Icon.ChevronRight className="size-4 rtl:rotate-180" />
        </Link>
      ) : (
        <span className={cn(itemClass, "gap-1 text-ink-faint")} aria-disabled="true">
          <span>Next</span>
          <Icon.ChevronRight className="size-4 rtl:rotate-180" />
        </span>
      )}
    </nav>
  );
}
