"use client";

import { useT } from "@/i18n/client";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function BatchesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("public");
  const common = useT("common");
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("errors.batches")}
      description={error.digest ? t("errors.bodyWithRef", { digest: error.digest }) : t("errors.body")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {common("actions.tryAgain")}
          </Button>
          <ButtonLink href="/dashboard" variant="outline">
            {t("errors.goToDashboard")}
          </ButtonLink>
        </div>
      }
    />
  );
}
