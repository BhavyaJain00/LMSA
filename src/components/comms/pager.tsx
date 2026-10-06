import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";

/** Previous / next links under a paginated list. Renders nothing for a single page. */
export function Pager({
  page,
  pageCount,
  total,
  noun,
  plural,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  total: number;
  /** Singular noun of the rows, e.g. "broadcast". */
  noun: string;
  /** Plural of the noun when it is irregular. */
  plural?: string;
  hrefFor: (page: number) => string;
}) {
  if (pageCount <= 1) return null;
  const disabled = "inline-flex h-8 items-center rounded-lg border border-border px-3 text-ink-faint";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-3 justify-between text-sm">
      <p className="text-ink-muted">
        Page {page} of {pageCount} · {formatNumber(total)} {total === 1 ? noun : (plural ?? `${noun}s`)}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <ButtonLink href={hrefFor(page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4 rtl:rotate-180" />}>
            Previous
          </ButtonLink>
        ) : (
          <span className={disabled} aria-disabled="true">
            Previous
          </span>
        )}
        {page < pageCount ? (
          <ButtonLink href={hrefFor(page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4 rtl:rotate-180" />}>
            Next
          </ButtonLink>
        ) : (
          <span className={disabled} aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </nav>
  );
}
