"use client";

import { Button, ButtonLink } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";

/** Error boundary for /messages. Messages are stored and drafts stay in this browser, so retrying loses nothing. */
export default function MessagesError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-96 flex-col items-center justify-center rounded-card border border-dashed border-border-strong px-6 py-16 text-center">
      <span className="mb-3 flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
        <Icon.AlertTriangle className="size-7" />
      </span>
      <h2 className="text-base font-semibold text-ink">Messages couldn&apos;t load</h2>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">Something went wrong on our side. Your conversations are safe, so please try again.</p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={reset} leftIcon={<Icon.Refresh className="size-4" />}>
          Try again
        </Button>
        <ButtonLink href="/dashboard" variant="outline" size="sm">
          Dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
