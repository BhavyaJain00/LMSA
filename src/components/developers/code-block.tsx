"use client";

import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { CopyButton } from "./copy-button";

/**
 * A scrollable code sample with a copy button. The block is focusable so
 * keyboard users can scroll long lines; `label` names it for screen readers
 * and appears above the code.
 */
export function CodeBlock({ code, label, className, maxHeight = true }: { code: string; label?: string; className?: string; maxHeight?: boolean }) {
  const t = useT("admin");
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface-2", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1">
        <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label ?? t("developers.code.label")}</span>
        <CopyButton value={code} label={label ? t("developers.code.copyNamed", { label }) : t("developers.code.copy")} iconOnly />
      </div>
      <pre
        dir="ltr"
        tabIndex={0}
        aria-label={label}
        className={cn("overflow-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", maxHeight && "max-h-96")}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
