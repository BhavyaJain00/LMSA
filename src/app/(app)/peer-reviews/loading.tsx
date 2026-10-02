import { CardSkeleton, Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

export default async function Loading() {
  const t = await getT("learning");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("peer.loading")}</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <Skeleton className="mt-6 h-9 w-56" />
      <div className="mt-5 space-y-3">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    </div>
  );
}
