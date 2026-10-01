import { Skeleton } from "@/components/ui/skeleton";

export default function MessagesLoading() {
  return (
    <div className="h-[calc(100dvh-12rem)] min-h-112 rounded-card border border-border bg-surface-1 p-6" aria-busy="true" aria-label="Loading">
      <Skeleton className="mx-auto mt-24 size-14 rounded-full" />
      <Skeleton className="mx-auto mt-4 h-4 w-48" />
      <Skeleton className="mx-auto mt-2 h-3 w-72 max-w-full" />
    </div>
  );
}
