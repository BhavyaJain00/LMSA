"use client";

import { useT } from "@/i18n/client";

/**
 * The `role="progressbar"` track of `ProgressBar`. A client component so the
 * default accessible name ("Progress") follows the interface language while
 * `ProgressBar` itself stays usable from Server Components.
 */
export function ProgressTrack({ value, label, trackClassName, fillClassName }: { value: number; label?: string; trackClassName: string; fillClassName: string }) {
  const t = useT("common");
  return (
    <div className={trackClassName} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? t("a11y.progress")}>
      <div className={fillClassName} style={{ width: `${value}%` }} />
    </div>
  );
}
