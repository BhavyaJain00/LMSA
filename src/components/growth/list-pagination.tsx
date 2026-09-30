import { ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { formatNumber } from "@/lib/utils";

/** "Page 2 of 5 · 112 seats" with previous/next links (growth lists; server-rendered). */
export function ListPagination({ page, pageCount, total, noun, href }: { page: number; pageCount: number; total: number; noun: string; href: (page: number) => string }) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="text-ink-muted">
        Page {page} of {pageCount} · {formatNumber(total)} {noun}
      </p>
      <div className="flex gap-2">
        {page > 1 && (
          <ButtonLink href={href(page - 1)} variant="outline" size="sm" leftIcon={<Icon.ChevronLeft className="size-4" />}>
            Previous
          </ButtonLink>
        )}
        {page < pageCount && (
          <ButtonLink href={href(page + 1)} variant="outline" size="sm" rightIcon={<Icon.ChevronRight className="size-4" />}>
            Next
          </ButtonLink>
        )}
      </div>
    </nav>
  );
}
