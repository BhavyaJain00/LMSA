"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

/** Error boundary content that keeps the app shell (used by error.tsx files). */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="Something went wrong"
      description={error.message && !error.digest ? error.message : "We couldn't load this page. Please try again."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          <ButtonLink href="/dashboard" variant="outline">
            Go to dashboard
          </ButtonLink>
        </div>
      }
    />
  );
}
