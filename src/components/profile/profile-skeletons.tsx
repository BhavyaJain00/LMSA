import type { ReactNode } from "react";
import { CardSkeleton, ListSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Tab body placeholder: text sections and a card grid beside a narrow list column. */
export function ProfileContentSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-3">
      <div className="min-w-0 space-y-8 lg:col-span-2">
        <div className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-3/4" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-32" />
          <div className="grid gap-4 sm:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </div>
      </div>
      <div className="space-y-6">
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <Skeleton className="mb-4 h-4 w-28" />
          <ListSkeleton rows={3} />
        </div>
        <div className="rounded-card border border-border bg-surface-1 p-4">
          <Skeleton className="mb-4 h-4 w-20" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-16 rounded-full" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-full rounded-lg" />
    </div>
  );
}

/** Edit profile form placeholder: photos, basic information, social links and timelines cards. */
export function ProfileEditSkeleton() {
  const card = (title: string, fields: number, extra?: ReactNode) => (
    <div className="rounded-card border border-border bg-surface-1">
      <div className="space-y-2 border-b border-border px-5 py-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-64 max-w-full" />
        <span className="sr-only">{title}</span>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        {Array.from({ length: fields }).map((_, i) => (
          <FieldSkeleton key={i} />
        ))}
        {extra}
      </div>
    </div>
  );
  return (
    <div className="space-y-6">
      <div className="rounded-card border border-border bg-surface-1">
        <div className="space-y-2 border-b border-border px-5 py-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="grid gap-6 p-5 md:grid-cols-2">
          <div className="flex items-center gap-4">
            <Skeleton className="size-20 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-lg" />
          </div>
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
      {card("Basic information", 6, <Skeleton className="h-24 w-full rounded-lg md:col-span-2" />)}
      {card("Social links", 4)}
      <div className="rounded-card border border-border bg-surface-1 p-5">
        <Skeleton className="h-4 w-40" />
        <div className="mt-4">
          <ListSkeleton rows={2} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Skeleton className="h-9 w-20 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
    </div>
  );
}
