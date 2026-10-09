import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/ui/page";
import { getT } from "@/i18n/server";

/** Placeholder rows shaped like the overview's list cards. */
function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1 shadow-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 sm:gap-4 sm:px-5">
          <Skeleton className="size-10 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
          <Skeleton className="h-5 w-12 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function SectionHeadingSkeleton() {
  return (
    <div className="mb-4 space-y-2">
      <Skeleton className="h-5 w-44" />
      <Skeleton className="h-3 w-56 max-w-full" />
    </div>
  );
}

/**
 * Admin overview placeholder. It lives in the `(overview)` route group so it only
 * covers `/admin` itself; every admin section keeps its own loading state.
 * Mirrors the page: greeting, four stat tiles, "Needs your attention" and "Recent enrollments".
 */
export default async function AdminOverviewLoading() {
  const t = await getT("admin");
  return (
    <PageContainer aria-busy="true" aria-live="polite" className="space-y-10">
      <span className="sr-only">{t("pages.overview.loading")}</span>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-9 w-56 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9.5 w-28 rounded-lg" />
          <Skeleton className="h-9.5 w-36 rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-4 sm:p-5">
            <Skeleton className="h-3.5 w-24 max-w-full" />
            <Skeleton className="mt-2 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-28 max-w-full" />
          </div>
        ))}
      </div>

      <div>
        <SectionHeadingSkeleton />
        <RowsSkeleton rows={2} />
      </div>

      <div>
        <SectionHeadingSkeleton />
        <RowsSkeleton rows={5} />
      </div>
    </PageContainer>
  );
}
