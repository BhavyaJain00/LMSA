"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

export default function AdminCoursesError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-ink">We couldn&apos;t load this course page</h1>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{error.message || "Something went wrong while loading the course data. Please try again."}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-6 flex gap-2">
        <Button onClick={() => retry()} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href="/admin/courses" variant="outline">
          All courses
        </ButtonLink>
      </div>
    </div>
  );
}
