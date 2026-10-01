"use client";

import { useParams } from "next/navigation";
import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function TranscriptEditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const params = useParams<{ id: string; lessonId: string }>();
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="The transcript editor could not be loaded"
      description={error.digest ? `Something went wrong on our side (ref ${error.digest}). Your saved transcript is not affected.` : "Something went wrong. Your saved transcript is not affected; please try again."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          {params?.id && params.lessonId && (
            <ButtonLink href={`/admin/courses/${params.id}/lessons/${params.lessonId}`} variant="outline">
              Back to the lesson editor
            </ButtonLink>
          )}
        </div>
      }
    />
  );
}
