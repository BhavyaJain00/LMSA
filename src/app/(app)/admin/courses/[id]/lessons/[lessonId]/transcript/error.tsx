"use client";

import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { useT } from "@/i18n/client";

export default function TranscriptEditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ id: string; lessonId: string }>();
  const t = useT("admin");
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title={t("errorPages.transcript.title")}
      description={error.digest ? t("errorPages.transcript.withReference", { digest: error.digest }) : t("errorPages.transcript.description")}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            {t("errorPages.tryAgain")}
          </Button>
          {params?.id && params.lessonId && (
            <ButtonLink href={`/admin/courses/${params.id}/lessons/${params.lessonId}`} variant="outline">
              {t("errorPages.backToLessonEditor")}
            </ButtonLink>
          )}
        </div>
      }
    />
  );
}
