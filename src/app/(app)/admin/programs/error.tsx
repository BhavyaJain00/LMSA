"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

export default function AdminProgramsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT("admin");
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("errorPages.generic.title")}
      description={error.digest ? t("errorPages.generic.withReference", { digest: error.digest }) : t("errorPages.generic.description")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {t("errorPages.tryAgain")}
          </Button>
          <ButtonLink href="/admin/programs" variant="outline">
            {t("errorPages.allPrograms")}
          </ButtonLink>
        </div>
      }
    />
  );
}
