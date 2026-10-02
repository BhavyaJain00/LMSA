import { Skeleton } from "@/components/ui/skeleton";
import { LoadingLabel } from "@/components/catalog/loading-label";

export default function CertificateLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <LoadingLabel />
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-80 max-w-full" />
        </div>
      </div>
      <Skeleton className="mx-auto aspect-[297/210] w-full max-w-5xl rounded-2xl" />
    </div>
  );
}
