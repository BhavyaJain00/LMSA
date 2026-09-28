"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/skeleton";
import { Icon } from "@/components/ui/icons";

export default function QuizError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="We couldn't load this quiz"
      description={error.message || "Something went wrong while loading the quiz. Please try again."}
      action={
        <div className="flex gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          <ButtonLink href="/dashboard" variant="outline">
            Go to dashboard
          </ButtonLink>
        </div>
      }
    />
  );
}
