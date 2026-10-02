"use client";

import { useParams } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

export default function LessonError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ slug: string }>();
  const t = useT("learning");
  const common = useT("common");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </span>
      <h1 className="mt-4 text-xl font-semibold tracking-tight text-ink">{t("learn.error.title")}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">{t("learn.error.body")}</p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-ink-faint" dir="ltr">
          {common("errors.reference", { digest: error.digest })}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          {common("actions.tryAgain")}
        </Button>
        <ButtonLink href={params?.slug ? `/courses/${params.slug}` : "/courses"} variant="outline">
          {t("learn.backToCourse")}
        </ButtonLink>
      </div>
    </div>
  );
}
