"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { reportClientError } from "@/lib/errors/report";

/**
 * Root error boundary (pages outside a route group's own boundary). The error
 * is reported to the admin error log; visitors see a reference code instead
 * of internal details.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
    reportClientError(error);
  }, [error]);
  return (
    <div role="alert" className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </span>
      <p className="mt-4 text-sm font-semibold uppercase tracking-wider text-danger">Something went wrong</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">We hit an unexpected error</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">
        The problem has been logged for the site team. Try again, or head back to the home page.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-ink-faint">
          Reference: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href="/" variant="outline">
          Go home
        </ButtonLink>
      </div>
    </div>
  );
}
