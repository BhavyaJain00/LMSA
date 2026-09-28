"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { changePasswordAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, FormSuccess, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Too short", "Weak", "Fair", "Good", "Strong", "Very strong"];
  return { score, label: labels[score]! };
}

/** Change password (current + new + confirm) using the shared auth action. */
export function PasswordForm() {
  const toast = useToast();
  const [values, setValues] = useState({ current: "", password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const res = await changePasswordAction(prev, fd);
    if (res.ok) {
      setValues({ current: "", password: "", confirm: "" });
      toast.success(res.message ?? "Password updated.");
    }
    return res;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const meter = strength(values.password);
  const mismatch = values.confirm.length > 0 && values.confirm !== values.password;


  return (
    <form action={action} className="space-y-4">
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && <FormSuccess message={state.message ?? "Password updated."} />}
      <Field label="Current password" htmlFor="current" required error={errors.current}>
        <Input
          id="current"
          name="current"
          type={show ? "text" : "password"}
          autoComplete="current-password"
          value={values.current}
          onChange={(e) => setValues((v) => ({ ...v, current: e.target.value }))}
          invalid={!!errors.current}
          required
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password" htmlFor="password" required error={errors.password}>
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            invalid={!!errors.password}
            required
            minLength={8}
          />
          {values.password && (
            <div className="mt-2" aria-live="polite">
              <div className="flex gap-1" aria-hidden="true">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full ${i < meter.score ? (meter.score <= 2 ? "bg-danger" : meter.score === 3 ? "bg-warning" : "bg-success") : "bg-surface-3"}`}
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-muted">Strength: {meter.label}</p>
            </div>
          )}
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" required error={errors.confirm ?? (mismatch ? "Passwords do not match" : undefined)}>
          <Input
            id="confirm"
            name="confirm"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={values.confirm}
            onChange={(e) => setValues((v) => ({ ...v, confirm: e.target.value }))}
            invalid={!!errors.confirm || mismatch}
            required
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setShow((s) => !s)} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink">
          {show ? <Icon.EyeOff className="size-4" /> : <Icon.Eye className="size-4" />}
          {show ? "Hide passwords" : "Show passwords"}
        </button>
        <Button type="submit" loading={pending} disabled={!values.current || !values.password || !values.confirm || mismatch}>
          Update password
        </Button>
      </div>
    </form>
  );
}
