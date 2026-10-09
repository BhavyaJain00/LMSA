"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

/** Fill colour of the spotlight and the text colour on top of it. */
export type SpotlightTone = "accent" | "violet" | "orange" | "sky" | "yellow";

const TONES: Record<SpotlightTone, { fill: string; ink: string; muted: string }> = {
  accent: { fill: "bg-accent", ink: "text-accent-fg", muted: "text-accent-fg/70" },
  violet: { fill: "bg-violet-300", ink: "text-slate-950", muted: "text-slate-950/65" },
  orange: { fill: "bg-orange-400", ink: "text-slate-950", muted: "text-slate-950/65" },
  sky: { fill: "bg-sky-400", ink: "text-slate-950", muted: "text-slate-950/65" },
  yellow: { fill: "bg-yellow-200", ink: "text-slate-950", muted: "text-slate-950/65" },
};

/**
 * A feature card: tag, big title and three keywords. Hovering (or focusing / tapping) floods the card with its
 * colour from the pointer and swaps the keywords for a one-sentence description. The description is always in
 * the page for screen readers; only its visibility changes.
 */
export function SpotlightCard({
  tag,
  title,
  keywords,
  description,
  watermark,
  tone,
  className,
}: {
  tag: string;
  title: string;
  keywords: string[];
  description: string;
  watermark: string;
  tone: SpotlightTone;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const colours = TONES[tone];

  const moveTo = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    const box = el?.getBoundingClientRect();
    if (!el || !box) return;
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    setOrigin({ x, y });
    // Lean the card towards the pointer in 3D.
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.transform = `perspective(1200px) rotateX(${(0.5 - y / box.height) * 8}deg) rotateY(${(x / box.width - 0.5) * 8}deg)`;
    }
  };
  const centre = () => {
    const box = ref.current?.getBoundingClientRect();
    if (box) setOrigin({ x: box.width / 2, y: box.height / 2 });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      centre();
      setOpen((v) => !v);
    }
  };
  const spot: CSSProperties = { left: origin.x, top: origin.y };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onMouseEnter={(e) => {
        moveTo(e);
        setOpen(true);
      }}
      onMouseMove={moveTo}
      onMouseLeave={() => {
        setOpen(false);
        if (ref.current) ref.current.style.transform = "";
      }}
      onClick={() => {
        // Touch screens have no hover: a tap toggles the card.
        if (!window.matchMedia("(hover: hover)").matches) {
          centre();
          setOpen((v) => !v);
        }
      }}
      onKeyDown={onKeyDown}
      className={cn(
        "group relative isolate flex min-h-64 cursor-pointer flex-col justify-between overflow-hidden rounded-3xl border border-border bg-surface-1 p-6 text-start shadow-card transition-[border-color,transform] duration-300 ease-out will-change-transform hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent sm:min-h-80 sm:p-9",
        className,
      )}
    >
      <span
        aria-hidden="true"
        style={spot}
        className={cn(
          "pointer-events-none absolute -z-10 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
          colours.fill,
          open ? "scale-[30]" : "scale-0",
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -bottom-6 -end-3 -z-10 select-none font-black uppercase leading-none tracking-tighter transition-colors duration-300 [font-size:clamp(4.5rem,9vw,8.5rem)]",
          open ? "text-black/10" : "text-ink/[0.04]",
        )}
      >
        {watermark}
      </span>

      <div>
        <p className={cn("font-mono text-micro font-bold uppercase tracking-widest transition-colors duration-300", open ? colours.muted : "text-ink-faint")}>{tag}</p>
        <h3 className={cn("mt-3 text-2xl font-extrabold tracking-tight transition-colors duration-300 sm:text-4xl", open ? colours.ink : "text-ink")}>{title}</h3>
      </div>

      <div className="relative mt-8 flex min-h-24 items-end">
        <ul
          aria-hidden={open}
          className={cn("flex flex-col gap-2.5 transition-all duration-300", open ? "pointer-events-none translate-y-2 opacity-0" : "translate-y-0 opacity-100")}
        >
          {keywords.map((k) => (
            <li key={k} className="flex items-center gap-2.5 font-mono text-xs uppercase tracking-wider text-ink-muted sm:text-sm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-ink/40" />
              {k}
            </li>
          ))}
        </ul>
        <p
          className={cn(
            "absolute inset-x-0 bottom-0 text-base font-medium leading-relaxed transition-all duration-300 sm:text-lg",
            colours.ink,
            open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          {description}
        </p>
      </div>
    </div>
  );
}
