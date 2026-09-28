"use client";

import { useActionState } from "react";
import { registerAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";

export function RegisterForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(registerAction, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
      <Field label="Full name" htmlFor="name" required error={errors.name}>
        <Input id="name" name="name" autoComplete="name" required placeholder="Ada Lovelace" invalid={!!errors.name} />
      </Field>
      <Field label="Email" htmlFor="email" required error={errors.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" invalid={!!errors.email} />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password} hint="At least 8 characters with letters and numbers.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} invalid={!!errors.password} />
      </Field>
      <Button type="submit" className="w-full" loading={pending} size="lg">
        Create account
      </Button>
      <p className="text-center text-xs text-ink-faint">By signing up you agree to the terms of use and privacy policy.</p>
    </form>
  );
}
