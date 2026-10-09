import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Lesson skeleton in the player's two panels: video, title row and text, then the outline panel. */
export default async function LessonLoading() {
  const t = await getT("learning");
  return (
    <div className="flex flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(320px,30%)] lg:gap-3 lg:px-3 lg:pb-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("learn.loading")}</span>
      <div className="min-w-0 flex-1 bg-panel px-4 pb-24 pt-4 sm:px-6 sm:pt-6 lg:min-h-[calc(100dvh-4.25rem)] lg:rounded-2xl lg:border lg:border-border lg:px-10 lg:pt-8 lg:shadow-sm">
        <div className="mx-auto w-full max-w-4xl animate-fade-in">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-48" />
              <Skeleton className="mt-3 h-8 w-3/4" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9.5 w-28 rounded-lg" />
              <Skeleton className="h-9.5 w-24 rounded-lg" />
            </div>
          </div>
          <div className="mt-10 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
      <aside className="hidden overflow-hidden bg-panel lg:sticky lg:top-14 lg:block lg:h-[calc(100dvh-4.25rem)] lg:rounded-2xl lg:border lg:border-border lg:shadow-sm" aria-hidden="true">
        <div className="px-5 pb-4 pt-5">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="mt-4 h-1.5 w-full rounded-full" />
          <Skeleton className="mt-4 h-9 w-full rounded-xl" />
        </div>
        <div className="space-y-5 border-t border-border p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              {Array.from({ length: 3 }).map((__, j) => (
                <div key={j} className="flex items-center gap-3">
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
