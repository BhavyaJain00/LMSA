"use client";

import { useActionState, useState } from "react";
import { registerAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { PasswordField } from "@/components/security/password-field";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";

export function RegisterForm({ next, minLength }: { next?: string; minLength: number }) {
  const [state, action, pending] = useActionState(registerAction, null);
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormError message={state && !state.ok && !Object.keys(errors).length ? state.error : null} />
      <Field label="Full name" htmlFor="name" required error={errors.name}>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          required
          placeholder="Ada Lovelace"
          invalid={!!errors.name}
          value={values.name}
          onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
        />
      </Field>
      <Field label="Email" htmlFor="email" required error={errors.email}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          invalid={!!errors.email}
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password}>
        <PasswordField
          id="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={minLength}
          invalid={!!errors.password}
          showIcon={false}
          value={values.password}
          onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
          aria-describedby="password-strength"
        />
        <PasswordStrengthMeter id="password-strength" password={values.password} minLength={minLength} context={[values.name, values.email.split("@")[0] ?? ""]} />
      </Field>
      <Button type="submit" className="w-full" loading={pending} size="lg">
        Create account
      </Button>
      <p className="text-center text-xs text-ink-faint">By signing up you agree to the terms of use and privacy policy. We&apos;ll email you a link to confirm your address.</p>
    </form>
  );
}
