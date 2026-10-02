"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { UnsavedChangesGuard } from "./unsaved-changes-guard";

/**
 * Sticky footer for manual-save forms: shows the save state badge
 * ("Not saved" / "Saving…" / "Saved" / "Save failed") next to the Save
 * button, and guards unsaved changes against accidental navigation.
 */
export function SaveBar({
  dirty,
  pending,
  saved,
  failed,
  label,
  extra,
  className,
  requireDirty = true,
}: {
  dirty: boolean;
  pending: boolean;
  saved?: boolean;
  /** The last save attempt was rejected (validation or permission error). */
  failed?: boolean;
  label?: string;
  extra?: ReactNode;
  className?: string;
  /** Disable the Save button until something changed. */
  requireDirty?: boolean;
}) {
  const t = useT("admin");
  const tc = useT("common");
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-1 mt-6 flex flex-wrap items-center gap-3 justify-between rounded-xl border border-border bg-surface-1/95 px-4 py-3 shadow-card backdrop-blur",
        className,
      )}
    >
      <div className="flex min-h-6 items-center gap-2 text-sm" aria-live="polite">
        {pending ? (
          <Badge tone="neutral">{tc("status.saving")}</Badge>
        ) : failed ? (
          <Badge tone="danger" dot>
            {t("global.saveBar.failed")}
          </Badge>
        ) : dirty ? (
          <Badge tone="warning" dot>
            {t("global.saveBar.notSaved")}
          </Badge>
        ) : saved ? (
          <Badge tone="success" dot>
            {tc("status.saved")}
          </Badge>
        ) : (
          <span className="text-xs text-ink-faint">{t("global.saveBar.allSaved")}</span>
        )}
        {extra}
      </div>
      <Button type="submit" loading={pending} disabled={requireDirty && !dirty}>
        {label ?? tc("actions.save")}
      </Button>
      <UnsavedChangesGuard when={dirty && !pending} />
    </div>
  );
}
