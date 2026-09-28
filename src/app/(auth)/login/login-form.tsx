"use client";

import { useActionState, useState } from "react";
import { loginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <FormError message={state && !state.ok ? state.error : null} />
      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" leftAddon={<Icon.Mail className="size-4" />} />
      </Field>
      <Field label="Password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          required
          placeholder="••••••••"
          leftAddon={<Icon.Lock className="size-4" />}
          rightAddon={
            <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide password" : "Show password"} className="pointer-events-auto text-ink-faint hover:text-ink">
              {show ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
            </button>
          }
        />
      </Field>
      <Button type="submit" className="w-full" loading={pending} size="lg">
        Log in
      </Button>
    </form>
  );
}
