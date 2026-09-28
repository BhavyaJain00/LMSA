import { Skeleton } from "@/components/ui/skeleton";

export default function AdminProgramsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>
      <Skeleton className="mb-6 h-9 w-full max-w-md" />
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-52 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
