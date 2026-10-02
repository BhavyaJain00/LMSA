"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

/** Error boundary content that keeps the app shell (used by error.tsx files). */
export function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("learning");
  const tc = useT("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("global.routeError.title")}
      description={error.message && !error.digest ? error.message : t("global.routeError.body")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {tc("actions.tryAgain")}
          </Button>
          <ButtonLink href="/dashboard" variant="outline">
            {t("global.routeError.dashboard")}
          </ButtonLink>
        </div>
      }
    />
  );
}
