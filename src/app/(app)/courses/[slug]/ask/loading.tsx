import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of the full-page AI tutor: conversation list (desktop) next to the chat. */
export default function AskAiLoading() {
  return (
    <div className="flex animate-fade-in flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the AI tutor…</span>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-7 w-28" />
        </div>
        <div className="flex gap-2 lg:hidden">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-16 rounded-lg" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <div className="hidden h-[calc(100dvh-11.5rem)] min-h-112 space-y-2 rounded-card border border-border bg-surface-1 p-3 lg:block">
          <Skeleton className="h-8 w-full rounded-lg" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-1.5 px-1 py-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          ))}
        </div>
        <div className="flex h-[calc(100dvh-16.5rem)] min-h-104 flex-col overflow-hidden rounded-card border border-border bg-surface-1 lg:h-[calc(100dvh-11.5rem)] lg:min-h-112">
          <div className="border-b border-border px-4 py-3 sm:px-6">
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4">
            <Skeleton className="size-11 rounded-full" />
            <Skeleton className="h-5 w-56" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <div className="mt-2 w-full max-w-md space-y-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </div>
          <div className="border-t border-border px-4 py-3 sm:px-6">
            <Skeleton className="mx-auto h-12 w-full max-w-3xl rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
