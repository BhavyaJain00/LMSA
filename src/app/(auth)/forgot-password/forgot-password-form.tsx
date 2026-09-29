"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { forgotPasswordAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

/** Request a reset link. The response is the same whether or not the account exists. */
export function ForgotPasswordForm({ defaultEmail }: { defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [state, action, pending] = useActionState<ActionResult<{ email: string }> | null, FormData>(forgotPasswordAction, null);
  const [editing, setEditing] = useState(false);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  if (state?.ok && !editing) {
    return (
      <div className="space-y-5" role="status">
        <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
          <Icon.Mail className="mt-0.5 size-5 shrink-0 text-success" />
          <div className="text-sm">
            <p className="font-medium text-ink">Check your email</p>
            <p className="mt-1 text-ink-muted">{state.message}</p>
          </div>
        </div>
        <ul className="space-y-1.5 text-xs text-ink-muted">
          <li>• It can take a minute or two to arrive. Check your spam or promotions folder too.</li>
          <li>• Only the newest link works — requesting another one cancels earlier links.</li>
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing(true)} leftIcon={<Icon.Refresh className="size-4" />}>
            Send again
          </Button>
          <Link href={`/login?email=${encodeURIComponent(state.data.email)}`} className="inline-flex h-9.5 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent hover:underline">
            <Icon.ArrowLeft className="size-4" />
            Back to log in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      action={(formData) => {
        setEditing(false);
        action(formData);
      }}
      className="space-y-4"
      noValidate
    >
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="Email" htmlFor="email" required error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          invalid={!!errors.email}
          leftAddon={<Icon.Mail className="size-4" />}
        />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending} disabled={!email.trim()}>
        Send reset link
      </Button>
    </form>
  );
}
