import { Skeleton } from "@/components/ui/skeleton";

export default function ConversationLoading() {
  return (
    <div
      className="flex h-[calc(100dvh-13rem)] min-h-96 flex-col overflow-hidden rounded-card border border-border bg-surface-1 lg:h-[calc(100dvh-12rem)] lg:min-h-112"
      aria-busy="true"
      aria-label="Loading conversation"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <Skeleton className="size-8 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex-1 space-y-4 p-4">
        <Skeleton className="h-10 w-2/3 rounded-2xl" />
        <Skeleton className="ml-auto h-14 w-1/2 rounded-2xl" />
        <Skeleton className="h-8 w-1/3 rounded-2xl" />
        <Skeleton className="ml-auto h-10 w-2/5 rounded-2xl" />
      </div>
      <div className="border-t border-border p-3">
        <Skeleton className="h-12 w-full rounded-card" />
      </div>
    </div>
  );
}
