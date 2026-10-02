import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

function CardPlaceholder({ lines, button = false }: { lines: number; button?: boolean }) {
  return (
    <div className="rounded-card border border-border bg-surface-1">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="space-y-3 p-5">
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 w-full" />
        ))}
        {button && <Skeleton className="h-9.5 w-44 rounded-lg" />}
      </div>
    </div>
  );
}

export default async function PrivacySettingsLoading() {
  const t = await getT("account");
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">{t("settings.privacy.loading")}</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-6">
        <div className="rounded-card border border-border bg-surface-1">
          <div className="space-y-2 border-b border-border px-5 py-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-80 max-w-full" />
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-28 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-9.5 w-44 rounded-lg" />
          </div>
        </div>
        <CardPlaceholder lines={3} button />
        <CardPlaceholder lines={2} />
        <CardPlaceholder lines={3} />
        <CardPlaceholder lines={4} button />
      </div>
    </div>
  );
}
