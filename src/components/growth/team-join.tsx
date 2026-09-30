"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import { acceptInviteAction, acceptSeatInviteAction } from "@/lib/actions/teams";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { FormError } from "@/components/ui/input";

/** "Accept invitation" on /join/<token>: the token travels in the form, never in client state. */
export function AcceptInviteForm({ token, label = "Accept invitation" }: { token: string; label?: string }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(acceptInviteAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      {state && !state.ok && <FormError message={state.error} />}
      <Button type="submit" size="lg" className="w-full" loading={pending} leftIcon={<Icon.CheckCircle className="size-5" />}>
        {label}
      </Button>
    </form>
  );
}

/** Accept an invitation listed on /team (addressed to the member's confirmed email). */
export function AcceptSeatButton({ seatId, teamName }: { seatId: string; teamName: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <Button
        loading={busy}
        aria-label={`Accept the invitation to ${teamName}`}
        onClick={() =>
          startTransition(async () => {
            const result = await acceptSeatInviteAction(seatId);
            // A successful accept redirects; only failures come back here.
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        Accept
      </Button>
      <FormError message={error} />
    </div>
  );
}
