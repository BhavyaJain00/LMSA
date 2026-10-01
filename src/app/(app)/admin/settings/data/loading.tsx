import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of Backup & restore while the storage overview and the backups folder are read. */
export default function DataSettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading backups…</span>
      <Skeleton className="h-6 w-44" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-surface-1 p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="mt-6 rounded-card border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-3.5 w-80 max-w-full" />
        </div>
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-9 w-full sm:w-44" />
            <Skeleton className="h-9 w-full sm:w-52" />
          </div>
          <Skeleton className="h-24 w-full" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-4 w-20 sm:block" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-6 rounded-card border border-border bg-surface-1">
        <div className="border-b border-border px-4 py-3.5 sm:px-5">
          <Skeleton className="h-4 w-28" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 px-4 py-4 sm:flex-row sm:justify-between sm:px-5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3.5 w-full sm:w-80" />
          </div>
        ))}
      </div>
    </div>
  );
}
