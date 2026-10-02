"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export default function AdminQuizzesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("errorPages.generic.title")}
      description={error.message || t("errorPages.generic.description")}
      action={
        <div className="flex gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {t("errorPages.tryAgain")}
          </Button>
          <ButtonLink href="/admin/quizzes" variant="outline">
            {t("errorPages.allQuizzes")}
          </ButtonLink>
        </div>
      }
    />
  );
}
