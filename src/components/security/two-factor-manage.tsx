"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { disableTwoFactorAction, regenerateRecoveryCodesAction } from "@/lib/actions/security";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { OtpCodeInput } from "./otp-code-input";
import { PasswordField } from "./password-field";
import { RecoveryCodesDialog } from "./recovery-codes-dialog";

type CodesResult = ActionResult<{ recoveryCodes: string[] }>;

/** Actions for an account with two-step verification on: new recovery codes, turn off. */
export function TwoFactorManage({ brand, email, canDisable, recoveryCodesLeft }: { brand: string; email: string; canDisable: boolean; recoveryCodesLeft: number }) {
  const [dialog, setDialog] = useState<"regenerate" | "disable" | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setDialog("regenerate")}>
        {recoveryCodesLeft > 0 ? "New recovery codes" : "Generate recovery codes"}
      </Button>
      {canDisable && (
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" leftIcon={<Icon.Unlock className="size-4" />} onClick={() => setDialog("disable")}>
          Turn off
        </Button>
      )}
      {dialog === "regenerate" && <RegenerateDialog brand={brand} email={email} onClose={() => setDialog(null)} />}
      {dialog === "disable" && <DisableDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function RegenerateDialog({ brand, email, onClose }: { brand: string; email: string; onClose: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [state, formAction, pending] = useActionState<CodesResult | null, FormData>(async (prev, formData) => {
    const result = await regenerateRecoveryCodesAction(prev, formData);
    if (result.ok) setCodes(result.data.recoveryCodes);
    else setCode("");
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  if (codes) {
    return (
      <RecoveryCodesDialog
        codes={codes}
        brand={brand}
        email={email}
        title="Your new recovery codes"
        onDone={() => {
          setCodes(null);
          onClose();
          router.refresh();
        }}
      />
    );
  }

  return (
    <Dialog open onClose={onClose} title="Generate new recovery codes" description="Your current recovery codes will stop working." size="sm">
      <form action={formAction} className="space-y-4" noValidate>
        <FormError message={state && !state.ok ? state.error : null} />
        <Field label="Code from your authenticator app" htmlFor="regen-code" error={errors.code}>
          <OtpCodeInput id="regen-code" value={code} onChange={setCode} invalid={!!errors.code} autoFocus disabled={pending} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={code.length !== 6}>
            Generate codes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await disableTwoFactorAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? "Two-step verification is off.");
      onClose();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Dialog
      open
      onClose={onClose}
      title="Turn off two-step verification?"
      description="Your account will only be protected by your password. Confirm with your password and a code."
      size="sm"
    >
      <form action={formAction} className="space-y-4" noValidate>
        <FormError message={state && !state.ok ? state.error : null} />
        <input type="hidden" name="method" value={method} />
        <Field label="Password" htmlFor="disable-password" required error={errors.password}>
          <PasswordField id="disable-password" name="password" autoComplete="current-password" required invalid={!!errors.password} autoFocus />
        </Field>
        {method === "totp" ? (
          <Field label="Code from your authenticator app" htmlFor="disable-code" required error={errors.code}>
            <OtpCodeInput id="disable-code" value={code} onChange={setCode} invalid={!!errors.code} disabled={pending} />
          </Field>
        ) : (
          <Field label="Recovery code" htmlFor="disable-recovery" required error={errors.recoveryCode}>
            <Input
              id="disable-recovery"
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              className="font-mono"
              invalid={!!errors.recoveryCode}
            />
          </Field>
        )}
        <button
          type="button"
          className="text-xs font-medium text-accent hover:underline"
          onClick={() => {
            setMethod((m) => (m === "totp" ? "recovery" : "totp"));
            setCode("");
          }}
        >
          {method === "totp" ? "Use a recovery code instead" : "Use my authenticator app instead"}
        </button>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Keep it on
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            Turn off
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
