"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";

export default function AdminProgramsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
          <ButtonLink href="/admin/programs" variant="outline">
            All programs
          </ButtonLink>
        </div>
      }
    />
  );
}
