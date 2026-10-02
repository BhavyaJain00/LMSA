import { Skeleton } from "@/components/ui/skeleton";
import { getT } from "@/i18n/server";

export default async function LegalEditorLoading() {
  const t = await getT("admin");
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("pages.settings.legal.loadingEditor")}</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-6 w-56" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <Skeleton className="mt-6 h-12 w-full rounded-card" />
      <Skeleton className="mt-5 h-3.5 w-16" />
      <Skeleton className="mt-2 h-9.5 w-full rounded-lg" />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-80 w-full rounded-lg lg:h-144" />
        <Skeleton className="hidden h-144 w-full rounded-lg lg:block" />
      </div>
    </div>
  );
}
