"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

/**
 * A rendered marketing email, shown the way a recipient sees it. The HTML
 * sits in an `<iframe sandbox>` without scripts, forms or same-origin access
 * (links open in a new tab), so it can never act in the staff member's session.
 */
export function EmailFrame({
  subject,
  html,
  busy,
  className,
  heightClass = "h-[560px] max-h-[70vh]",
}: {
  subject: string;
  html: string;
  /** Dim the frame while a newer version is being rendered. */
  busy?: boolean;
  className?: string;
  heightClass?: string;
}) {
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  return (
    <div className={cn("overflow-hidden rounded-card border border-border bg-surface-1", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 sm:px-4">
        <p className="min-w-0 text-sm">
          <span className="text-ink-muted">Subject: </span>
          <span className="break-words font-medium text-ink">{subject}</span>
        </p>
        <SegmentedControl
          size="xs"
          className="shrink-0"
          value={width}
          onChange={setWidth}
          options={[
            { value: "desktop", label: <span className="sr-only">Desktop width</span>, icon: <Icon.Monitor className="size-3.5" /> },
            { value: "mobile", label: <span className="sr-only">Phone width</span>, icon: <Icon.Smartphone className="size-3.5" /> },
          ]}
        />
      </div>
      <div className="bg-surface-2 p-2 sm:p-4" aria-busy={busy || undefined}>
        <iframe
          title={`Preview of “${subject}”`}
          srcDoc={html}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          referrerPolicy="no-referrer"
          className={cn(
            "mx-auto block rounded-lg border border-border bg-white transition-[width,opacity]",
            heightClass,
            width === "mobile" ? "w-[375px] max-w-full" : "w-full",
            busy && "opacity-60",
          )}
        />
      </div>
    </div>
  );
}
