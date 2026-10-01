import { Skeleton } from "@/components/ui/skeleton";

export default function PostEditorLoading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the editor…</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-3 h-7 w-80 max-w-full" />
      <Skeleton className="mt-2 h-4 w-64" />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-96 w-full rounded-card" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-card" />
          <Skeleton className="h-40 w-full rounded-card" />
        </div>
      </div>
    </div>
  );
}
