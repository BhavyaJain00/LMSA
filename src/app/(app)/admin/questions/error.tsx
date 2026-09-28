"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";

export default function AdminQuestionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="Something went wrong"
      description={error.message || "We couldn't load this page. Please try again."}
      action={
        <div className="flex gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          <ButtonLink href="/admin/questions" variant="outline">
            Question bank
          </ButtonLink>
        </div>
      }
    />
  );
}
