"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

/** Card-shaped placeholder shared by the sign-in, sign-up and account-recovery screens. */
export default function AuthLoading() {
  const t = useT("common");
  return (
    <div className="w-full max-w-md" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("status.loading")}</span>
      <div className="rounded-2xl border border-border bg-surface-1 p-6 shadow-card sm:p-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-2 h-4 w-64 max-w-full" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3.5 w-20" />
              <Skeleton className="h-9.5 w-full rounded-lg" />
            </div>
          ))}
          <Skeleton className="h-11 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
