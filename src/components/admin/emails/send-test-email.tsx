"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { sendTestEmailAction, type TestEmailResult } from "@/lib/actions/email-settings";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, FormSuccess, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** "Send a test email" form (Settings → Email and the outbox). Delivery happens before the action returns. */
export function SendTestEmailForm({ defaultTo, onSent, autoFocus }: { defaultTo: string; onSent?: () => void; autoFocus?: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [to, setTo] = useState(defaultTo);
  const [state, action, pending] = useActionState<ActionResult<TestEmailResult> | null, FormData>(async (prev, formData) => {
    const result = await sendTestEmailAction(prev, formData);
    if (result.ok) {
      if (result.data.status === "sent") toast.success(result.message ?? "Test email sent");
      else toast.toast({ title: "Test email queued", description: result.message, tone: "warning" });
      router.refresh();
      onSent?.();
    } else {
      toast.error("Test email failed", result.error);
    }
    return result;
  }, null);
  const fieldError = state && !state.ok ? state.fieldErrors?.to : undefined;

  return (
    <form action={action} className="space-y-3" noValidate>
      <Field label="Send to" htmlFor="test-email-to" required error={fieldError} hint="The message is delivered right away with the current settings.">
        <Input
          id="test-email-to"
          name="to"
          type="email"
          autoComplete="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
          invalid={!!fieldError}
          autoFocus={autoFocus}
          leftAddon={<Icon.Mail className="size-4" />}
        />
      </Field>
      {state && !state.ok && !fieldError && <FormError message={state.error} />}
      {state?.ok && (
        <FormSuccess
          message={
            state.data.status === "sent" ? `Sent. Check the inbox (and spam folder) of ${to}.` : (state.message ?? "Queued — delivery will be retried automatically.")
          }
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {state?.ok ? (
          <Link href={`/admin/emails/${state.data.id}`} className="text-sm font-medium text-accent hover:underline">
            View in outbox
          </Link>
        ) : (
          <span />
        )}
        <Button type="submit" loading={pending} disabled={!to.trim()} leftIcon={<Icon.Send className="size-4" />}>
          Send test email
        </Button>
      </div>
    </form>
  );
}
