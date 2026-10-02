import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

export default async function SubmissionLoading() {
  const t = await getT("learning");
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("quiz.submission.loading")}</span>
      <Skeleton className="h-4 w-56" />
      <Skeleton className="mt-3 h-7 w-72 max-w-full" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="rounded-card border border-border bg-surface-1 p-5 lg:order-last">
          <div className="flex items-center gap-3">
            <Skeleton className="size-14 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        </div>
        <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
