"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Error boundary body for the leaderboard, points and community routes (keeps the app shell). */
export function GamificationRouteError({
  error,
  onRetry,
  title,
  backHref = "/dashboard",
  backLabel = "Go to dashboard",
}: {
  error: Error & { digest?: string };
  onRetry: () => void;
  title: string;
  backHref?: string;
  backLabel?: string;
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
      <p className="mt-1 max-w-md text-sm text-ink-muted">Something went wrong while loading this page. Please try again in a moment.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">Reference: {error.digest}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={onRetry} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href={backHref} variant="outline">
          {backLabel}
        </ButtonLink>
      </div>
    </div>
  );
}
