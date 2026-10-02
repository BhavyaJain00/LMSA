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
import { useT } from "@/i18n/client";

type CodesResult = ActionResult<{ recoveryCodes: string[] }>;

/** Actions for an account with two-step verification on: new recovery codes, turn off. */
export function TwoFactorManage({ brand, email, canDisable, recoveryCodesLeft }: { brand: string; email: string; canDisable: boolean; recoveryCodesLeft: number }) {
  const [dialog, setDialog] = useState<"regenerate" | "disable" | null>(null);
  const t = useT("account");
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setDialog("regenerate")}>
        {recoveryCodesLeft > 0 ? t("security.manage.newCodes") : t("security.manage.generateCodes")}
      </Button>
      {canDisable && (
        <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" leftIcon={<Icon.Unlock className="size-4" />} onClick={() => setDialog("disable")}>
          {t("security.manage.turnOff")}
        </Button>
      )}
      {dialog === "regenerate" && <RegenerateDialog brand={brand} email={email} onClose={() => setDialog(null)} />}
      {dialog === "disable" && <DisableDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

function RegenerateDialog({ brand, email, onClose }: { brand: string; email: string; onClose: () => void }) {
  const router = useRouter();
  const t = useT("account");
  const tc = useT("common");
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
        title={t("security.manage.newCodesTitle")}
        onDone={() => {
          setCodes(null);
          onClose();
          router.refresh();
        }}
      />
    );
  }

  return (
    <Dialog open onClose={onClose} title={t("security.manage.regenTitle")} description={t("security.manage.regenBody")} size="sm">
      <form action={formAction} className="space-y-4" noValidate>
        <FormError message={state && !state.ok ? state.error : null} />
        <Field label={t("security.setup.codeLabel")} htmlFor="regen-code" error={errors.code}>
          <OtpCodeInput id="regen-code" value={code} onChange={setCode} invalid={!!errors.code} autoFocus disabled={pending} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {tc("actions.cancel")}
          </Button>
          <Button type="submit" loading={pending} disabled={code.length !== 6}>
            {t("security.manage.generate")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DisableDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const t = useT("account");
  const [method, setMethod] = useState<"totp" | "recovery">("totp");
  const [code, setCode] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, formData) => {
    const result = await disableTwoFactorAction(prev, formData);
    if (result.ok) {
      toast.success(result.message ?? t("security.manage.disabled"));
      onClose();
    }
    return result;
  }, null);
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};

  return (
    <Dialog
      open
      onClose={onClose}
      title={t("security.manage.disableTitle")}
      description={t("security.manage.disableBody")}
      size="sm"
    >
      <form action={formAction} className="space-y-4" noValidate>
        <FormError message={state && !state.ok ? state.error : null} />
        <input type="hidden" name="method" value={method} />
        <Field label={t("security.manage.password")} htmlFor="disable-password" required error={errors.password}>
          <PasswordField id="disable-password" name="password" autoComplete="current-password" required invalid={!!errors.password} autoFocus />
        </Field>
        {method === "totp" ? (
          <Field label={t("security.setup.codeLabel")} htmlFor="disable-code" required error={errors.code}>
            <OtpCodeInput id="disable-code" value={code} onChange={setCode} invalid={!!errors.code} disabled={pending} />
          </Field>
        ) : (
          <Field label={t("security.manage.recoveryCode")} htmlFor="disable-recovery" required error={errors.recoveryCode}>
            <Input
              id="disable-recovery"
              name="recoveryCode"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="xxxxx-xxxxx"
              className="font-mono"
              dir="ltr"
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
          {method === "totp" ? t("security.manage.useRecovery") : t("security.manage.useApp")}
        </button>
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t("security.manage.keepOn")}
          </Button>
          <Button type="submit" variant="danger" loading={pending}>
            {t("security.manage.turnOff")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
