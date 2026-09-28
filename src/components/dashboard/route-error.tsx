"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Error boundary body used by this area's error.tsx files; keeps the app shell visible. */
export function RouteError({
  error,
  reset,
  title = "This page couldn't be loaded",
  homeHref = "/dashboard",
  homeLabel = "Go to dashboard",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </div>
      <h2 className="text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{error.message || "Something went wrong while loading this page. Please try again."}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href={homeHref} variant="outline">
          {homeLabel}
        </ButtonLink>
      </div>
    </div>
  );
}
