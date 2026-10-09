import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card classes shared by every block of the course page. */
export const courseCardClasses = "rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5";

/**
 * One full-width block of the course page: a card with a bold title, an optional one-line description and an
 * optional action on the right ("View all", "Write a review"…).
 */
export function SectionCard({
  id,
  headingId,
  title,
  description,
  aside,
  className,
  children,
}: {
  /** Anchor of the section (`#curriculum`, `#reviews`…). */
  id?: string;
  headingId: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={headingId} className={cn(courseCardClasses, "scroll-mt-20", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-heading font-bold text-ink">
            {title}
          </h2>
          {description && <div className="mt-0.5 text-meta text-ink-faint">{description}</div>}
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** "a • b • c" meta line, wrapping on narrow screens (empty parts are skipped). A block element. */
export function MetaDots({ parts, className }: { parts: ReactNode[]; className?: string }) {
  const items = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  if (!items.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      {items.map((part, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-2">
          {i > 0 && <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-current opacity-60" />}
          {part}
        </span>
      ))}
    </div>
  );
}
