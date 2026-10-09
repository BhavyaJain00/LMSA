"use client";

import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";

/** Collapsed height in rem: about four lines of body text (leading-7). */
const COLLAPSED_REM = 7;

/**
 * Clamps long content to about four lines with a fade and a "Show more" / "Show less" toggle. The content is
 * rendered on the server and stays in the page (readable by screen readers and search engines); the toggle only
 * appears once the browser has measured that the content is taller than the clamp. Tabbing to a link hidden by
 * the clamp expands it.
 */
export function ShowMore({ children, className }: { children: ReactNode; className?: string }) {
  const t = useT("public");
  const id = useId();
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setOverflows(inner.offsetHeight > COLLAPSED_REM * rem + 4);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, []);

  const collapsed = !expanded;
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (!collapsed || !overflows || !outerRef.current) return;
    const box = outerRef.current.getBoundingClientRect();
    if (event.target.getBoundingClientRect().bottom > box.bottom) setExpanded(true);
  };

  return (
    <div className={className}>
      <div
        ref={outerRef}
        id={id}
        onFocus={onFocus}
        className={cn(
          "relative",
          collapsed && "max-h-28 overflow-hidden",
          collapsed && overflows && "[mask-image:linear-gradient(to_bottom,black_55%,transparent)]",
        )}
      >
        <div ref={innerRef}>{children}</div>
      </div>
      {(overflows || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 rounded-md text-sm font-semibold text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {expanded ? t("course.page.showLess") : t("course.page.showMore")}
          <Icon.ChevronDown className={cn("size-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
