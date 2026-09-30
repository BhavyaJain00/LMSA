"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/** How long the button shows "Preparing…" (the browser gives no signal when a download starts). */
const BUSY_MS = 6000;

/**
 * "Download my data" form. A plain POST to `/api/privacy/export`, so the
 * browser saves the streamed JSON file itself and it works without
 * JavaScript. `children` can add fields (the admin form adds a member picker
 * that writes `userId`).
 */
export function DataExportForm({
  label = "Download my data",
  busyLabel = "Preparing your file…",
  variant = "primary",
  size = "md",
  className,
  children,
  disabled,
}: {
  label?: string;
  busyLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setBusy(false), BUSY_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  return (
    <form method="post" action="/api/privacy/export" onSubmit={() => setBusy(true)} className={cn("space-y-3", className)}>
      {children}
      <Button type="submit" variant={variant} size={size} loading={busy} disabled={disabled} leftIcon={<Icon.Download className="size-4" />}>
        {busy ? busyLabel : label}
      </Button>
      <span className="sr-only" role="status" aria-live="polite">
        {busy ? "Your download is being prepared. Your browser will save a JSON file shortly." : ""}
      </span>
    </form>
  );
}
