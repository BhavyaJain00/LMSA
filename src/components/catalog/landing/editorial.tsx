import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DISPLAY, EDITORIAL } from "./fonts";

/** Small uppercase label with a pulsing dot ("• OUR APPROACH"). */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("inline-flex select-none items-center gap-2.5 font-mono text-micro font-semibold uppercase tracking-widest text-ink-muted", className)}>
      <span aria-hidden="true" className="size-2 rounded-full bg-accent motion-safe:animate-pulse" />
      {children}
    </p>
  );
}

/** Hand-drawn double underline in the accent colour, stretched under the text it follows. */
export function Squiggle({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 26"
      fill="none"
      preserveAspectRatio="none"
      className={cn("pointer-events-none absolute -bottom-2 start-0 h-3.5 w-[104%] overflow-visible text-accent sm:-bottom-3 sm:h-5", className)}
    >
      <path d="M 4 17 C 80 7, 200 6, 316 16" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M 12 21 C 95 11, 210 10, 308 20" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

/** The italic serif part of a heading, optionally underlined with the squiggle. */
export function Emphasis({ children, squiggle = false }: { children: ReactNode; squiggle?: boolean }) {
  return (
    <span className={cn("relative inline-block font-normal italic", EDITORIAL)}>
      {children}
      {squiggle && <Squiggle />}
    </span>
  );
}

/**
 * Section heading in the editorial style: eyebrow, a bold grotesk title ending in an italic serif phrase,
 * an optional one-line description and an optional action on the right ("View all →").
 */
export function SectionHeading({
  id,
  eyebrow,
  title,
  emphasis,
  description,
  action,
  center = false,
  squiggle = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  emphasis?: string;
  description?: string;
  action?: ReactNode;
  center?: boolean;
  squiggle?: boolean;
}) {
  return (
    <div className={cn("mb-8 flex gap-4", center ? "flex-col items-center text-center" : "flex-col sm:flex-row sm:items-end sm:justify-between")}>
      <div className={cn("min-w-0", center ? "max-w-3xl" : "max-w-2xl")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className={cn("mt-3 text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl lg:text-5xl", DISPLAY)}>
          {title}
          {emphasis && (
            <>
              {" "}
              <Emphasis squiggle={squiggle}>{emphasis}</Emphasis>
            </>
          )}
        </h2>
        {description && <p className={cn("mt-4 text-base leading-relaxed text-ink-muted", center && "mx-auto max-w-2xl")}>{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
