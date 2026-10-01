"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";

export interface CodeSample {
  id: string;
  label: string;
  code: string;
}

/**
 * The same example in several languages. Tabs follow the WAI-ARIA tabs
 * pattern: arrow keys, Home and End move between them.
 */
export function CodeTabs({ samples, title, className }: { samples: readonly CodeSample[]; title?: string; className?: string }) {
  const [active, setActive] = useState(samples[0]?.id ?? "");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();
  const current = samples.find((sample) => sample.id === active) ?? samples[0];
  if (!current) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = samples.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    setActive(samples[next]!.id);
    tabs.current[next]?.focus();
  };

  return (
    <div className={className}>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        {title && <p className="text-xs font-medium text-ink-muted">{title}</p>}
        {samples.length > 1 && (
          <div role="tablist" aria-label={title ?? "Language"} className="inline-flex rounded-lg bg-surface-2 p-0.5">
            {samples.map((sample, index) => {
              const selected = sample.id === current.id;
              return (
                <button
                  key={sample.id}
                  ref={(node) => {
                    tabs.current[index] = node;
                  }}
                  id={`${base}-tab-${sample.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`${base}-panel`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(sample.id)}
                  onKeyDown={(event) => onKeyDown(event, index)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
                    selected ? "bg-surface-1 text-ink shadow-sm" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {sample.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div id={`${base}-panel`} role={samples.length > 1 ? "tabpanel" : undefined} aria-labelledby={samples.length > 1 ? `${base}-tab-${current.id}` : undefined}>
        <CodeBlock code={current.code} label={current.label} />
      </div>
    </div>
  );
}
