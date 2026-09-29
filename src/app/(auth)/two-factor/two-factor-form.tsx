"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/lib/types";
import { cancelTwoFactorLoginAction, verifyTwoFactorLoginAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { OtpCodeInput } from "@/components/security/otp-code-input";

/** Second sign-in step: authenticator code, or a recovery code as fallback. */
export function TwoFactorForm({ next, recoveryAvailable }: { next?: string; recoveryAvailable: boolean }) {
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await verifyTwoFactorLoginAction(prev, formData);
    if (!result.ok) setCode("");
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  const expired = errors.session === "expired";

  if (expired) {
    return (
      <div className="space-y-4">
        <FormError message={state && !state.ok ? state.error : null} />
        <Link href="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
          <Icon.ArrowLeft className="size-4" />
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4" noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="method" value={method} />
        <FormError message={state && !state.ok ? state.error : null} />
        {method === "totp" ? (
          <Field label="Authentication code" htmlFor="code" error={errors.code} hint="Open your authenticator app and enter the 6-digit code for this account.">
            <OtpCodeInput id="code" value={code} onChange={setCode} invalid={!!errors.code} autoFocus autoSubmit disabled={pending} label="Authentication code" />
          </Field>
        ) : (
          <Field
            label="Recovery code"
            htmlFor="recoveryCode"
            error={errors.recoveryCode}
            hint="Enter one of the codes you saved when you turned on two-step verification. Each code works once."
          >
            <Input
              id="recoveryCode"
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              placeholder="xxxxx-xxxxx"
              className="h-12 text-center font-mono text-lg tracking-widest"
              invalid={!!errors.recoveryCode}
            />
          </Field>
        )}
        <Button type="submit" className="w-full" size="lg" loading={pending} disabled={method === "totp" && code.length !== 6}>
          Verify and sign in
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4 text-sm">
        {recoveryAvailable || method === "recovery" ? (
          <button
            type="button"
            className="font-medium text-accent hover:underline"
            onClick={() => {
              setMethod((m) => (m === "totp" ? "recovery" : "totp"));
              setCode("");
            }}
          >
            {method === "totp" ? "Use a recovery code" : "Use my authenticator app"}
          </button>
        ) : (
          <span className="text-xs text-ink-muted">Lost your phone? Contact an administrator to reset two-step verification.</span>
        )}
        <form action={cancelTwoFactorLoginAction}>
          <button type="submit" className="font-medium text-ink-muted hover:text-ink">
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
