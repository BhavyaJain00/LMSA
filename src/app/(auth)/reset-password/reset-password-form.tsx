"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { resetPasswordAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/input";
import { PasswordField } from "@/components/security/password-field";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";

/** Choose a new password for the account behind a reset link. */
export function ResetPasswordForm({ token, email, name, minLength }: { token: string; email: string; name: string; minLength: number }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  const [values, setValues] = useState({ password: "", confirm: "" });
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const mismatch = values.confirm.length > 0 && values.confirm !== values.password;
  const linkDead = !!errors.token;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {/* Helps password managers save the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <FormError message={state && !state.ok ? state.error : null} />
      {linkDead ? (
        <Link href={`/forgot-password?email=${encodeURIComponent(email)}`} className="inline-block text-sm font-medium text-accent hover:underline">
          Request a new reset link →
        </Link>
      ) : (
        <>
          <Field label="New password" htmlFor="password" required error={errors.password}>
            <PasswordField
              id="password"
              name="password"
              autoComplete="new-password"
              required
              autoFocus
              minLength={minLength}
              value={values.password}
              onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
              invalid={!!errors.password}
              aria-describedby="new-password-strength"
            />
            <PasswordStrengthMeter id="new-password-strength" password={values.password} minLength={minLength} context={[name, email.split("@")[0] ?? ""]} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" required error={errors.confirm ?? (mismatch ? "Passwords do not match" : undefined)}>
            <PasswordField
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              required
              value={values.confirm}
              onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
              invalid={!!errors.confirm || mismatch}
            />
          </Field>
          <Button type="submit" className="w-full" size="lg" loading={pending} disabled={!values.password || !values.confirm || mismatch}>
            Reset password and sign in
          </Button>
          <p className="text-center text-xs text-ink-faint">You&apos;ll be signed out on all other devices.</p>
        </>
      )}
    </form>
  );
}
