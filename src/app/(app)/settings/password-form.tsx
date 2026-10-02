"use client";

import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { changePasswordAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, FormSuccess, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { PasswordStrengthMeter } from "@/components/security/password-strength-meter";
import { useT } from "@/i18n/client";

/**
 * Change password (current + new + confirm) using the shared auth action.
 * `minLength` is `settings.security.passwordMinLength` (the server enforces
 * it too); `context` holds personal words (name, email name) for the meter.
 */
export function PasswordForm({ minLength, context = [] }: { minLength: number; context?: string[] }) {
  const toast = useToast();
  const t = useT("account");
  const [values, setValues] = useState({ current: "", password: "", confirm: "" });
  const [show, setShow] = useState(false);
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const res = await changePasswordAction(prev, fd);
    if (res.ok) {
      setValues({ current: "", password: "", confirm: "" });
      toast.success(res.message ?? t("settings.password.updated"));
    }
    return res;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const mismatch = values.confirm.length > 0 && values.confirm !== values.password;


  return (
    <form action={action} className="space-y-4">
      <FormError message={state && !state.ok ? state.error : null} />
      {state?.ok && <FormSuccess message={state.message ?? t("settings.password.updated")} />}
      <Field label={t("settings.password.current")} htmlFor="current" required error={errors.current}>
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
        <Field label={t("settings.password.new")} htmlFor="password" required error={errors.password}>
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => setValues((v) => ({ ...v, password: e.target.value }))}
            invalid={!!errors.password}
            required
            minLength={minLength}
            aria-describedby="settings-password-strength"
          />
          <PasswordStrengthMeter id="settings-password-strength" password={values.password} minLength={minLength} context={context} />
        </Field>
        <Field label={t("settings.password.confirm")} htmlFor="confirm" required error={errors.confirm ?? (mismatch ? t("settings.password.mismatch") : undefined)}>
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
          {show ? t("settings.password.hide") : t("settings.password.show")}
        </button>
        <Button type="submit" loading={pending} disabled={!values.current || !values.password || !values.confirm || mismatch}>
          {t("settings.password.submit")}
        </Button>
      </div>
    </form>
  );
}
