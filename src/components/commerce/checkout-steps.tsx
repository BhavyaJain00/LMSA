import { Icon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

const STEPS = ["Your details", "Payment", "Confirmation"];

/**
 * "1 Your details — 2 Payment — 3 Confirmation" above the checkout. On the checkout page (`stage` "checkout")
 * the first two steps are the current page; on the order page ("done") they are ticked off.
 */
export function CheckoutSteps({ stage = "checkout", className }: { stage?: "checkout" | "done"; className?: string }) {
  const done = stage === "done";
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 text-sm", className)} aria-label="Checkout progress">
      {STEPS.map((label, i) => {
        const finished = done && i < 2;
        const active = done ? i === 2 : i < 2;
        return (
          <li key={label} className="flex items-center gap-3">
            <span className={cn("flex items-center gap-2 font-medium", active || finished ? "text-ink" : "text-ink-faint")} aria-current={active && (done || i === 1) ? "step" : undefined}>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-xs font-bold",
                  finished ? "bg-success text-white" : active ? "bg-accent text-accent-fg" : "bg-surface-2 text-ink-faint ring-1 ring-border",
                )}
              >
                {finished ? <Icon.Check className="size-3.5" aria-hidden="true" /> : i + 1}
              </span>
              {label}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden="true" className={cn("h-px w-8 sm:w-14", finished || (active && i === 0) ? "bg-accent/60" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
