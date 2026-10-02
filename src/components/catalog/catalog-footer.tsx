"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Spinner } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

function LoadMoreLabel() {
  const { pending } = useLinkStatus();
  const common = useT("common");
  return (
    <>
      {pending && <Spinner className="size-4" />}
      {pending ? common("status.loading") : common("actions.loadMore")}
    </>
  );
}

/**
 * Catalog footer: page-length selector (24 / 60 / 120), "Load More" and the
 * "<shown> of <total>" readout. Paging is URL-driven (`?limit=&page=`).
 */
export function CatalogFooter({
  shown,
  total,
  pageSize,
  pageSizes,
  nextHref,
}: {
  shown: number;
  total: number;
  pageSize: number;
  pageSizes: readonly number[];
  nextHref: string | null;
}) {
  const t = useT("public");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const changePageSize = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value === String(pageSizes[0])) params.delete("limit");
    else params.set("limit", value);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  return (
    <div className="mt-8 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-2 text-sm text-ink-muted">
        {t.rich("catalog.footer.perPage", {
          select: () => (
            <select
              value={pageSize}
              onChange={(e) => changePageSize(e.target.value)}
              disabled={pending}
              className="h-8 rounded-lg border border-border-strong bg-surface-1 px-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              {pageSizes.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          ),
          text: (chunks) => <span>{chunks}</span>,
        })}
        {pending && <Spinner className="size-4" />}
      </label>
      <div className="flex items-center gap-3">
        {nextHref && (
          <>
            <Link href={nextHref} scroll={false} className={buttonClasses({ variant: "outline", size: "sm" })}>
              <LoadMoreLabel />
            </Link>
            <span className="h-5 w-px bg-border" aria-hidden="true" />
          </>
        )}
        <p className="text-sm tabular-nums text-ink-muted" aria-live="polite">
          {t.rich("catalog.footer.shown", { shown, total, b: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}
        </p>
      </div>
    </div>
  );
}
