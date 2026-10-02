import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

function CardPlaceholder({ rows, children }: { rows: number; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface-1">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
      <div className="space-y-4 p-5">
        {children}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SettingsLoading() {
  const t = await getT("account");
  return (
    <div aria-busy="true" aria-live="polite" className="mx-auto max-w-3xl">
      <span className="sr-only">{t("settings.loading")}</span>
      <div className="mb-6 space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="space-y-6">
        <CardPlaceholder rows={0}>
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
          <Skeleton className="h-3 w-2/3" />
        </CardPlaceholder>
        <CardPlaceholder rows={3} />
        <CardPlaceholder rows={0}>
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-10 flex-1 rounded-lg" />
            ))}
          </div>
        </CardPlaceholder>
        <CardPlaceholder rows={0}>
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-9 w-40 rounded-lg" />
        </CardPlaceholder>
      </div>
    </div>
  );
}
