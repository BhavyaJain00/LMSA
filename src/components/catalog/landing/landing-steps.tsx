"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";

export interface LandingStep {
  title: string;
  summary: string;
  chips: string[];
}

const STRIPES = ["bg-accent", "bg-orange-400", "bg-sky-400", "bg-violet-300"];
const NUMBERS = ["text-accent", "text-orange-500 dark:text-orange-400", "text-sky-600 dark:text-sky-400", "text-violet-600 dark:text-violet-300"];

/**
 * Numbered steps ("01 FIND", "02 LEARN", ...): one open at a time, the open one shows its chips. Each step
 * header is a real button controlling its panel, so keyboards and screen readers get a normal disclosure.
 */
export function LandingSteps({ steps, displayClass }: { steps: LandingStep[]; displayClass: string }) {
  const [open, setOpen] = useState(0);
  const id = useId();
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, i) => {
        const active = i === open;
        const panelId = `${id}-panel-${i}`;
        return (
          <li
            key={step.title}
            className={cn(
              "relative overflow-hidden rounded-3xl border transition-all duration-300",
              active ? "border-border-strong bg-surface-1 shadow-card" : "border-border bg-transparent opacity-80 hover:opacity-100",
            )}
          >
            <span aria-hidden="true" className={cn("absolute inset-y-0 start-0 w-1.5 transition-opacity duration-300", STRIPES[i % STRIPES.length], active ? "opacity-100" : "opacity-0")} />
            <button
              type="button"
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setOpen(i)}
              className="flex w-full flex-col gap-2 p-6 text-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:p-8 md:flex-row md:items-center md:justify-between md:gap-6"
            >
              <span className="flex items-center gap-5">
                <span className={cn("font-mono text-sm font-bold sm:text-base", active ? NUMBERS[i % NUMBERS.length] : "text-ink-faint")}>{String(i + 1).padStart(2, "0")}</span>
                <span className={cn("text-2xl font-extrabold uppercase tracking-tight text-ink sm:text-4xl", displayClass)}>{step.title}</span>
              </span>
              <span className="max-w-md text-sm text-ink-muted sm:text-base">{step.summary}</span>
            </button>
            <div id={panelId} role="region" aria-label={step.title} hidden={!active} className="px-6 pb-6 sm:px-8 sm:pb-8">
              <ul className="flex flex-wrap gap-2.5 border-t border-border pt-5">
                {step.chips.map((chip) => (
                  <li key={chip} className="rounded-full border border-border bg-surface-2 px-4 py-2 font-mono text-xs text-ink sm:text-sm">
                    {chip}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
