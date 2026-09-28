"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Error boundary for the catalog and course pages (keeps the app shell). */
export default function CoursesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center" role="alert">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-base font-semibold text-ink">We couldn&apos;t load the courses</h1>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">Something went wrong while loading this page. Please try again in a moment.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href="/" variant="outline">
          Go home
        </ButtonLink>
      </div>
    </div>
  );
}
