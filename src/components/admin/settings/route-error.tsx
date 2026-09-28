"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

/** Error boundary body shared by the admin, billing and jobs routes (keeps the app shell). */
export function RouteError({
  error,
  reset,
  title = "This page failed to load",
  backHref = "/dashboard",
  backLabel = "Go to dashboard",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  backHref?: string;
  backLabel?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={title}
      description={error.digest ? `Something went wrong on our side (reference ${error.digest}). Please try again.` : error.message || "Something went wrong. Please try again."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          <ButtonLink href={backHref} variant="outline">
            {backLabel}
          </ButtonLink>
        </div>
      }
    />
  );
}
