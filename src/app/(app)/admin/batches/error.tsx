"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function AdminBatchesError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<Icon.AlertTriangle />}
      title="Something went wrong"
      description={error.digest ? `We couldn't load this page (ref ${error.digest}).` : "We couldn't load this page. Please try again."}
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
            Try again
          </Button>
          <ButtonLink href="/admin/batches" variant="outline">
            All batches
          </ButtonLink>
        </div>
      }
    />
  );
}
