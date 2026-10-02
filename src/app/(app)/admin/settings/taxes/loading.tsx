import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

/** Skeleton of the Taxes & currencies panel (the settings nav stays in place). */
export default async function TaxesSettingsLoading() {
  const t = await getT("admin");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("pages.settings.taxes.loading")}</span>
      <Skeleton className="h-6 w-52" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-5 h-44 w-full rounded-card" />
      <Skeleton className="mt-6 h-5 w-32" />
      <Skeleton className="mt-3 h-48 w-full rounded-card" />
      <Skeleton className="mt-6 h-5 w-48" />
      <Skeleton className="mt-3 h-56 w-full rounded-card" />
    </div>
  );
}
