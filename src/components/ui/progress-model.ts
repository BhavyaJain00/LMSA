import { clamp } from "@/lib/utils";

export interface ProgressBarParts {
  /** Rounded percentage, 0-100. */
  percent: number;
  /** Accessible name of the `role="progressbar"` element (undefined: the generic "Progress"). */
  ariaLabel: string | undefined;
  /** Whether the visible caption row (caption and/or percentage) is rendered. */
  showHeader: boolean;
  /** Whether the visible caption text is rendered (false: only the percentage, if any). */
  showCaption: boolean;
  /** Whether the percentage is printed in the caption row. */
  showValue: boolean;
}

/**
 * Decides what `ProgressBar` shows. `label` only names the bar for assistive
 * technology and is never printed; a visible caption comes from `caption`.
 * For backwards compatibility `showLabel` (print the percentage) also prints
 * `label` when no `caption` is given, because callers that ask for the
 * percentage row want to say what it measures ("Your progress  40%").
 */
export function progressBarParts(opts: { value: number; label?: string; caption?: unknown; showLabel?: boolean }): ProgressBarParts {
  const percent = clamp(Math.round(Number.isFinite(opts.value) ? opts.value : 0), 0, 100);
  const hasCaption = opts.caption !== undefined && opts.caption !== null && opts.caption !== false && opts.caption !== "";
  const showValue = Boolean(opts.showLabel);
  const showCaption = hasCaption || (showValue && Boolean(opts.label));
  return {
    percent,
    ariaLabel: opts.label || undefined,
    showHeader: showCaption || showValue,
    showCaption,
    showValue,
  };
}
