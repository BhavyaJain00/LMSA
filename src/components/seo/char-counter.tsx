import { cn } from "@/lib/utils";

/**
 * Character counter for titles and meta descriptions, coloured by the range
 * search engines display in full: muted while there is room, green inside
 * `min`–`max`, amber once the text will be cut off. Announced politely to
 * screen readers. Usable from Server and Client Components.
 */
export function CharCounter({ length, min, max, className }: { length: number; min: number; max: number; className?: string }) {
  const tone = length === 0 ? "text-ink-faint" : length > max ? "text-warning" : length < min ? "text-ink-muted" : "text-success";
  const hint = length === 0 ? "" : length > max ? " · may be cut off" : length < min ? " · room for more" : " · good length";
  return (
    <p className={cn("mt-1 text-right text-xs tabular-nums", tone, className)} aria-live="polite">
      {length}/{max}
      {hint}
    </p>
  );
}
