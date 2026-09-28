import { Skeleton } from "@/components/ui/skeleton";

/** Lesson skeleton: content column + outline sidebar. */
export default function LessonLoading() {
  return (
    <div className="flex-1 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,30%)]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading lesson…</span>
      <div className="min-w-0 px-4 pb-24 pt-6 sm:px-6 lg:px-10 lg:pt-8">
        <div className="mx-auto w-full max-w-4xl animate-fade-in">
          <Skeleton className="h-4 w-64 max-w-full" />
          <Skeleton className="mt-5 h-3 w-48" />
          <Skeleton className="mt-3 h-8 w-3/4" />
          <div className="mt-4 flex items-center gap-2">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="mt-8 aspect-video w-full rounded-xl" />
          <div className="mt-8 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <Skeleton className="mt-8 h-32 w-full rounded-xl" />
        </div>
      </div>
      <aside className="hidden border-l border-border bg-surface-1 lg:block" aria-hidden="true">
        <div className="border-b border-border px-5 py-4">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-4 h-2 w-full rounded-full" />
        </div>
        <div className="space-y-4 p-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-4 w-2/3" />
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="flex items-center gap-2 pl-6">
                  <Skeleton className="size-4 rounded-full" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
