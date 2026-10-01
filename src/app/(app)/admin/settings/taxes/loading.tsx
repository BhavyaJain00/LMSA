import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton of the Taxes & currencies panel (the settings nav stays in place). */
export default function TaxesSettingsLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading taxes and currencies…</span>
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
