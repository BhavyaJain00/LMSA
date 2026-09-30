import { Skeleton } from "@/components/ui/skeleton";

/** Loading state of the AI tutor admin pages: header, tabs, filters and answer cards. */
export default function AiAdminLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the AI tutor review…</span>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-3 h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 flex gap-4 border-b border-border pb-2.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-9.5 w-full sm:w-52" />
        ))}
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3 w-64 max-w-full" />
            <Skeleton className="mt-3 h-4 w-3/4" />
            <Skeleton className="mt-2 h-3 w-full" />
            <Skeleton className="mt-1.5 h-3 w-5/6" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
