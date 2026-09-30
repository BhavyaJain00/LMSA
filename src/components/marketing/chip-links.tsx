import Link from "next/link";
import { cn } from "@/lib/utils";

export interface ChipLink {
  href: string;
  label: string;
  /** Number shown after the label (courses in a category, uses of a topic…). */
  count?: number;
}

/**
 * Wrapping list of pill links used for internal linking between landing
 * pages (categories, topics). Server Component.
 */
export function ChipLinks({ items, label, className }: { items: ChipLink[]; label: string; className?: string }) {
  if (!items.length) return null;
  return (
    <ul aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {items.map((item) => (
        <li key={item.href} className="min-w-0 max-w-full">
          <Link
            href={item.href}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="truncate">{item.label}</span>
            {item.count !== undefined && <span className="shrink-0 text-xs font-normal tabular-nums text-ink-muted">{item.count}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}
