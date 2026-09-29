import { Skeleton } from "@/components/ui/skeleton";

export default function PaymentCancelledLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Checking your order…</span>
      <Skeleton className="h-4 w-44" />
      <Skeleton className="mt-3 h-7 w-52" />
      <div className="mx-auto mt-6 w-full max-w-xl rounded-card border border-border bg-surface-1 p-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="size-14 rounded-full" />
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="mt-6 h-20 w-full rounded-xl" />
        <div className="mt-6 flex justify-center gap-2">
          <Skeleton className="h-9.5 w-28 rounded-lg" />
          <Skeleton className="h-9.5 w-36 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
