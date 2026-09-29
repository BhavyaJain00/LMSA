import { Skeleton } from "@/components/ui/skeleton";

export default function PersonaLoading() {
  return (
    <div aria-busy="true" aria-live="polite" className="min-h-[70vh]">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto flex w-full max-w-md flex-col items-stretch pt-6 sm:pt-16">
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="mt-8 h-7 w-3/4" />
        <Skeleton className="mt-2 h-4 w-full" />
        <div className="mt-6 flex flex-wrap gap-2">
          {["w-20", "w-28", "w-24", "w-16", "w-32", "w-20", "w-24", "w-28"].map((w, i) => (
            <Skeleton key={i} className={`h-8 rounded-lg ${w}`} />
          ))}
        </div>
        <div className="mt-8 flex items-center justify-between">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-28 rounded-lg" />
        </div>
      </div>
    </div>
  );
}
