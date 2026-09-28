import { Skeleton } from "@/components/ui/skeleton";

export default function LessonEditorLoading() {
  return (
    <div className="animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading lesson editor…</span>
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="mt-4 flex items-center justify-between border-b border-border pb-3">
        <Skeleton className="h-8 w-24 rounded-lg" />
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <div className="rounded-card border border-border bg-surface-1 p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-8 w-2/3" />
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Skeleton className="h-9.5 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
          </div>
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-card border border-border bg-surface-1">
              <div className="border-b border-border px-3 py-2.5">
                <Skeleton className="h-5 w-32" />
              </div>
              <div className="p-4">
                <Skeleton className="h-40 w-full rounded-lg" />
              </div>
            </div>
          ))}
        </div>
        <div className="hidden space-y-4 lg:block">
          <Skeleton className="h-20 rounded-card" />
          <Skeleton className="h-72 rounded-card" />
        </div>
      </div>
    </div>
  );
}
