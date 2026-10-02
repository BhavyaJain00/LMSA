"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

/** Error boundary body shared by the admin, billing and jobs routes (keeps the app shell). */
export function RouteError({
  error,
  reset,
  title,
  backHref = "/dashboard",
  backLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  backHref?: string;
  backLabel?: string;
}) {
  const t = useT("admin");
  const tc = useT("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={title ?? t("global.routeError.title")}
      description={error.digest ? t("global.routeError.withReference", { digest: error.digest }) : error.message || tc("errors.generic")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {tc("actions.tryAgain")}
          </Button>
          <ButtonLink href={backHref} variant="outline">
            {backLabel ?? t("global.routeError.backToDashboard")}
          </ButtonLink>
        </div>
      }
    />
  );
}
