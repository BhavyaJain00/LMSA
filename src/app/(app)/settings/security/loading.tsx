import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

function CardPlaceholder({ rows }: { rows: number }) {
  return (
    <div className="rounded-card border border-border bg-surface-1">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="space-y-4 p-5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SecuritySettingsLoading() {
  const t = await getT("account");
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">{t("security.loading")}</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-6">
        <CardPlaceholder rows={1} />
        <CardPlaceholder rows={1} />
        <CardPlaceholder rows={2} />
        <CardPlaceholder rows={4} />
      </div>
    </div>
  );
}
