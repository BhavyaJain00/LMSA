import { CourseCardSkeleton } from "@/components/catalog/course-card";
import { PageContainer } from "@/components/ui/page";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Same shape as the home page: greeting, the course to continue, a short list and three course cards. */
export default async function DashboardLoading() {
  const t = await getT("account");
  return (
    <PageContainer aria-busy="true" aria-live="polite" className="space-y-10">
      <span className="sr-only">{t("dashboard.loading")}</span>

      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>

      <div>
        <Skeleton className="mb-4 h-6 w-44" />
        <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface-1 sm:flex-row">
          <Skeleton className="aspect-video w-full rounded-none sm:aspect-auto sm:min-h-48 sm:w-60 lg:w-96" />
          <div className="flex flex-1 flex-col p-4 sm:p-6">
            <Skeleton className="h-6 w-3/5" />
            <Skeleton className="mt-3 h-4 w-2/5" />
            <Skeleton className="mt-8 h-1.5 w-full" />
            <Skeleton className="mt-3 h-3 w-1/3" />
            <Skeleton className="mt-5 h-11 w-full rounded-xl sm:w-48" />
          </div>
        </div>
      </div>

      <div>
        <Skeleton className="mb-4 h-6 w-32" />
        <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 sm:px-5">
              <Skeleton className="size-10 rounded-xl" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </div>

      <div>
        <Skeleton className="mb-4 h-6 w-48" />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CourseCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
