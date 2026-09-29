import { Skeleton } from "@/components/ui/skeleton";

export default function ImportMembersLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading import…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
      </div>
    </div>
  );
}
