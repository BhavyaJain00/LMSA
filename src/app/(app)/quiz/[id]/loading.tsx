import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

export default async function QuizLoading() {
  const t = await getT("learning");
  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("quiz.page.loading")}</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-3 h-7 w-72 max-w-full" />
      <div className="mt-6 rounded-card border border-border bg-surface-1 p-6">
        <Skeleton className="mx-auto h-6 w-60 max-w-full" />
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24 rounded-full" />
          ))}
        </div>
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
        <Skeleton className="mx-auto mt-6 h-11 w-36 rounded-xl" />
      </div>
    </div>
  );
}
