"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function BatchesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="We couldn't load batches"
      description={error.digest ? `Something went wrong on our side (ref ${error.digest}). Please try again.` : "Something went wrong on our side. Please try again."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
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
