"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export default function QuizError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("learning");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("quiz.error.title")}
      description={error.message || t("quiz.error.body")}
      action={
        <div className="flex gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {t("quiz.runner.tryAgain")}
          </Button>
          <ButtonLink href="/dashboard" variant="outline">
            {t("quiz.error.dashboard")}
          </ButtonLink>
        </div>
      }
    />
  );
}
