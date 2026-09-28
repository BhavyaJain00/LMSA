"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sticky footer for manual-save forms: shows the save state badge
 * ("Not saved" / "Saving…" / "Saved") next to the Save button.
 */
export function SaveBar({
  dirty,
  pending,
  saved,
  label = "Save",
  extra,
  className,
  requireDirty = true,
}: {
  dirty: boolean;
  pending: boolean;
  saved?: boolean;
  label?: string;
  extra?: ReactNode;
  className?: string;
  /** Disable the Save button until something changed. */
  requireDirty?: boolean;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-1/95 px-4 py-3 shadow-card backdrop-blur",
        className,
      )}
    >
      <div className="flex min-h-6 items-center gap-2 text-sm" aria-live="polite">
        {pending ? (
          <Badge tone="neutral">Saving…</Badge>
        ) : dirty ? (
          <Badge tone="warning" dot>
            Not saved
          </Badge>
        ) : saved ? (
          <Badge tone="success" dot>
            Saved
          </Badge>
        ) : (
          <span className="text-xs text-ink-faint">All changes saved</span>
        )}
        {extra}
      </div>
      <Button type="submit" loading={pending} disabled={requireDirty && !dirty}>
        {label}
      </Button>
    </div>
  );
}
