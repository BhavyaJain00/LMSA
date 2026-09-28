import { Skeleton } from "@/components/ui/skeleton";

/** Content-area skeleton while a settings panel loads (the settings nav stays in place). */
export default function SettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading settings…</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-72 max-w-full" />
      <div className="mt-6 space-y-5">
        {Array.from({ length: 2 }).map((_, s) => (
          <div key={s} className="rounded-card border border-border bg-surface-1">
            <div className="border-b border-border px-5 py-4">
              <Skeleton className="h-4 w-32" />
            </div>
            {Array.from({ length: 3 }).map((__, r) => (
              <div key={r} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-3.5 w-36" />
                  <Skeleton className="h-3 w-64 max-w-full" />
                </div>
                <Skeleton className="h-9 w-full sm:w-72" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
