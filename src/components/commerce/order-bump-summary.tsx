"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * Whether the checkout's order-bump box is ticked, shared between the
 * billing form (which owns the checkbox) and the order summary sidebar, which
 * are separate client islands on the checkout page.
 */
let ticked = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the billing form when the buyer ticks or unticks the order bump. */
export function setOrderBumpTicked(value: boolean): void {
  if (ticked === value) return;
  ticked = value;
  for (const listener of listeners) listener();
}

export function useOrderBumpTicked(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => ticked,
    () => false,
  );
}

/**
 * The order-bump line under the order summary: shows the add-on and the new
 * total today once the buyer ticks the offer in the billing form.
 */
export function OrderBumpSummary({ title, priceLabel, totalWithBumpLabel }: { title: string; priceLabel: string; totalWithBumpLabel: string }) {
  const on = useOrderBumpTicked();
  // A new checkout page starts unticked (the state is module-wide in the browser).
  useEffect(() => () => setOrderBumpTicked(false), []);
  return (
    <div aria-live="polite" className={on ? "rounded-card border border-success/40 bg-success/8 p-4 text-sm shadow-card" : "sr-only"}>
      {on && (
        <dl className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <dt className="flex min-w-0 items-start gap-2 text-ink">
              <Icon.Plus className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-xs font-medium uppercase tracking-wide text-ink-muted">Added to this order</span>
                <span className="block font-medium">{title}</span>
              </span>
            </dt>
            <dd className="shrink-0 tabular-nums text-ink">{priceLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border-strong pt-2">
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink">Total today:</dt>
            <dd className="text-lg font-bold tabular-nums text-ink">{totalWithBumpLabel}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
