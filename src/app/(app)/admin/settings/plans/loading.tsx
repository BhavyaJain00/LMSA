import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of the plans panel (the settings nav stays in place). */
export default function PlansSettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading membership plans…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-5 h-24 w-full rounded-card" />
      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-card" />
        ))}
      </div>
      <Skeleton className="mt-5 h-9 w-56" />
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-56 rounded-card" />
        ))}
      </div>
    </div>
  );
}
