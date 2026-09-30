import { Skeleton } from "@/components/ui/skeleton";

export default function JoinTeamLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto flex min-h-[60vh] w-full max-w-xl items-center py-6">
      <span className="sr-only">Loading your invitation…</span>
      <div className="w-full space-y-4 rounded-card border border-border bg-surface-1 p-6 sm:p-8">
        <Skeleton className="mx-auto size-14 rounded-full" />
        <Skeleton className="mx-auto h-7 w-56" />
        <Skeleton className="mx-auto h-4 w-72 max-w-full" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}
