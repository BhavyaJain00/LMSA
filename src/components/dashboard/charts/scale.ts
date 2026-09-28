/** Chart helpers shared by the custom SVG charts. */

export type ChartTone = "accent" | "success" | "info" | "warning" | "danger" | "muted";

const toneVar: Record<ChartTone, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  info: "var(--info)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  muted: "var(--ink-faint)",
};

export function chartColor(tone: ChartTone): string {
  return toneVar[tone];
}

/** Categorical palette built from the design tokens (cycled for long lists). */
export const categoricalTones: ChartTone[] = ["accent", "info", "success", "warning", "danger", "muted"];

export function categoricalColor(index: number): string {
  return chartColor(categoricalTones[index % categoricalTones.length]!);
}

/**
 * A "nice" integer axis: returns a rounded maximum and evenly spaced ticks
 * (0 … max) so gridlines land on readable numbers.
 */
export function niceScale(maxValue: number, tickCount = 4): { max: number; ticks: number[] } {
  const safeMax = Math.max(0, maxValue);
  if (safeMax === 0) return { max: tickCount, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i) };
  const rawStep = safeMax / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  const niceResidual = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = Math.max(1, Math.ceil(niceResidual * magnitude));
  const max = step * tickCount;
  return { max, ticks: Array.from({ length: tickCount + 1 }, (_, i) => i * step) };
}
