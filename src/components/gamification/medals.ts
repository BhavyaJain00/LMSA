/**
 * Place chips for 1st, 2nd and 3rd (podium, top contributors), built from
 * the design tokens so they work in light and dark mode: gold uses the
 * warning hue, silver the neutral surface, bronze the accent colour.
 */
export const MEDAL_CHIP: readonly string[] = [
  "bg-warning text-surface-1",
  "bg-surface-3 text-ink ring-1 ring-border-strong",
  "bg-accent text-accent-fg",
];
