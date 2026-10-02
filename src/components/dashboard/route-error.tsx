"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/**
 * Error boundary body used by error.tsx files across the app; keeps the app shell visible.
 * Its default strings are `global.` keys because it renders in every section.
 */
export function RouteError({
  error,
  reset,
  title,
  homeHref = "/dashboard",
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  const t = useT("account");
  const tc = useT("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </div>
      <h2 className="text-base font-semibold text-ink">{title ?? t("global.routeError.title")}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{error.message || t("global.routeError.body")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">{tc("errors.reference", { digest: error.digest })}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          {tc("actions.tryAgain")}
        </Button>
        <ButtonLink href={homeHref} variant="outline">
          {homeLabel ?? t("global.routeError.home")}
        </ButtonLink>
      </div>
    </div>
  );
}
