"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { resubscribeWithTokenAction, unsubscribeWithTokenAction } from "@/lib/actions/email-preferences";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";

/**
 * Confirmation shown after a one-click unsubscribe link, with Undo. Works
 * without a session: the signed token travels with the form.
 */
export function UnsubscribeResult({ userId, scope, token, label, email }: { userId: string; scope: string; token: string; label: string; email: string }) {
  const [subscribed, setSubscribed] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = subscribed ? await unsubscribeWithTokenAction(prev, formData) : await resubscribeWithTokenAction(prev, formData);
    if (result.ok) setSubscribed((s) => !s);
    return result;
  }, null);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <span className={subscribed ? "rounded-full bg-success/12 p-2.5 text-success" : "rounded-full bg-accent/12 p-2.5 text-accent"}>
        {subscribed ? <Icon.CheckCircle className="size-6" /> : <Icon.Mail className="size-6" />}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div aria-live="polite">
          <h2 className="text-base font-semibold text-ink">{subscribed ? "You're subscribed again" : "You've been unsubscribed"}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {subscribed ? (
              <>
                <span className="font-medium text-ink">{email}</span> will receive {label} again.
              </>
            ) : (
              <>
                <span className="font-medium text-ink">{email}</span> will no longer receive {label}. Password resets, security notices and receipts are still sent.
              </>
            )}
          </p>
        </div>
        <FormError message={state && !state.ok ? state.error : null} />
        <form action={action}>
          <input type="hidden" name="u" value={userId} />
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="t" value={token} />
          <Button type="submit" variant="outline" size="sm" loading={pending} leftIcon={subscribed ? <Icon.XCircle className="size-4" /> : <Icon.Replay className="size-4" />}>
            {subscribed ? "Unsubscribe again" : "Undo — keep me subscribed"}
          </Button>
        </form>
      </div>
    </div>
  );
}
