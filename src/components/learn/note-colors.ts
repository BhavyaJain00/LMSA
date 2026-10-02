import type { NoteColor } from "@/lib/types";

/**
 * Note / highlight colors. These are literal colors the learner picks (like
 * the card gradients in utils), so they use the Tailwind palette instead of
 * the semantic theme tokens. Values are chosen to read well in light and dark.
 */
export interface NoteColorStyle {
  value: NoteColor;
  label: string;
  /** Solid swatch (color picker dot, chip). */
  swatch: string;
  /** Left border accent for note cards. */
  border: string;
  /** Soft background for quotes. */
  soft: string;
  /** CSS color used by the ::highlight() rule for text highlights. */
  highlight: string;
}

export const NOTE_COLORS: NoteColorStyle[] = [
  {
    value: "yellow",
    label: "Yellow",
    swatch: "bg-yellow-400",
    border: "border-s-yellow-400",
    soft: "bg-yellow-400/15",
    highlight: "color-mix(in srgb, var(--color-yellow-400, #facc15) 45%, transparent)",
  },
  {
    value: "green",
    label: "Green",
    swatch: "bg-emerald-500",
    border: "border-s-emerald-500",
    soft: "bg-emerald-500/15",
    highlight: "color-mix(in srgb, var(--color-emerald-400, #34d399) 40%, transparent)",
  },
  {
    value: "blue",
    label: "Blue",
    swatch: "bg-sky-500",
    border: "border-s-sky-500",
    soft: "bg-sky-500/15",
    highlight: "color-mix(in srgb, var(--color-sky-400, #38bdf8) 40%, transparent)",
  },
  {
    value: "purple",
    label: "Purple",
    swatch: "bg-violet-500",
    border: "border-s-violet-500",
    soft: "bg-violet-500/15",
    highlight: "color-mix(in srgb, var(--color-violet-400, #a78bfa) 40%, transparent)",
  },
  {
    value: "red",
    label: "Red",
    swatch: "bg-rose-500",
    border: "border-s-rose-500",
    soft: "bg-rose-500/15",
    highlight: "color-mix(in srgb, var(--color-rose-400, #fb7185) 40%, transparent)",
  },
];

export function noteColorStyle(color: NoteColor): NoteColorStyle {
  return NOTE_COLORS.find((c) => c.value === color) ?? NOTE_COLORS[0]!;
}

/** Name of the CSS custom highlight registered for a note color. */
export function highlightName(color: NoteColor): string {
  return `ll-note-${color}`;
}

export const FLASH_HIGHLIGHT = "ll-note-flash";

/** Stylesheet for the CSS Custom Highlight API (no DOM mutation of lesson content). */
export const HIGHLIGHT_CSS = [
  ...NOTE_COLORS.map((c) => `::highlight(${highlightName(c.value)}){background-color:${c.highlight};}`),
  `::highlight(${FLASH_HIGHLIGHT}){background-color:color-mix(in srgb, var(--accent) 35%, transparent);text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:2px;}`,
].join("");
