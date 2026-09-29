import { Skeleton } from "@/components/ui/skeleton";

export default function NewProgramLoading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mb-6 mt-3 h-8 w-56" />
      <div className="space-y-4 rounded-card border border-border bg-surface-1 p-5">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
    </div>
  );
}
