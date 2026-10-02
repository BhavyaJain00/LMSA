"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export default function VideoAnalyticsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useT("admin");
  const params = useParams<{ id: string }>();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[50vh] flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-6" />
      </span>
      <h1 className="text-lg font-semibold text-ink">{t("errorPages.videoAnalytics.title")}</h1>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{t("errorPages.videoAnalytics.description")}</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-ink-faint">{t("errorPages.reference", { digest: error.digest })}</p>}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()} leftIcon={<Icon.Refresh className="size-4" />}>
          {t("errorPages.tryAgain")}
        </Button>
        <ButtonLink href={params?.id ? `/admin/courses/${params.id}?tab=dashboard` : "/admin/courses"} variant="outline">
          {t("errorPages.backToCourse")}
        </ButtonLink>
      </div>
    </div>
  );
}
