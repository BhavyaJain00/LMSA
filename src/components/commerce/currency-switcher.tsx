"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setCurrencyAction } from "@/lib/actions/taxes";
import { Select } from "@/components/ui/input";
import { Icon, Spinner } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/**
 * "Pay in" currency picker shown at checkout when the item has fixed prices
 * in other currencies. The choice is remembered (cookie) and the page is
 * re-priced on the server.
 */
export function CurrencySwitcher({ currencies, current }: { currencies: string[]; current: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card">
      <label htmlFor="checkout-currency" className="flex items-center gap-2 text-sm font-medium text-ink">
        {pending ? <Spinner className="size-4" /> : <Icon.Globe className="size-4 text-ink-muted" aria-hidden="true" />}
        Pay in
      </label>
      <Select
        id="checkout-currency"
        className="w-28"
        value={current.toUpperCase()}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => {
          const code = e.target.value;
          startTransition(async () => {
            const res = await setCurrencyAction(code);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            router.refresh();
          });
        }}
        options={currencies.map((c) => ({ value: c, label: c }))}
      />
    </div>
  );
}
