"use client";

import { useState } from "react";
import { deleteAccountAction } from "@/lib/actions/privacy";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { PasswordField } from "@/components/security/password-field";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { useT } from "@/i18n/client";

/** "Delete my account" button + confirmation dialog (password, two-step code when on, and the word DELETE). */
export function DeleteAccountButton({ needsCode, blocked }: { needsCode: boolean; blocked: boolean }) {
  const [open, setOpen] = useState(false);
  const t = useT("account");
  const [confirm, setConfirm] = useState("");
  const { onSubmit, pending, errors, formError } = useFormAction(deleteAccountAction, { toastSuccess: false, toastError: false });

  const close = () => {
    if (pending) return;
    setOpen(false);
    setConfirm("");
  };

  return (
    <>
      <Button variant="danger" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setOpen(true)} disabled={blocked}>
        {t("settings.privacy.delete.button")}
      </Button>
      <Dialog open={open} onClose={close} title={t("settings.privacy.delete.dialogTitle")} description={t("settings.privacy.delete.dialogBody")}>
        <form id="delete-account" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormError message={formError && !Object.keys(errors).length ? formError : null} />
          <Field label={t("settings.privacy.delete.password")} htmlFor="delete-password" required error={errors.password}>
            <PasswordField id="delete-password" name="password" autoComplete="current-password" required invalid={!!errors.password} autoFocus />
          </Field>
          {needsCode && (
            <Field label={t("settings.privacy.delete.code")} htmlFor="delete-code" required error={errors.code} hint={t("settings.privacy.delete.codeHint")}>
              <Input id="delete-code" name="code" autoComplete="one-time-code" inputMode="text" maxLength={64} required invalid={!!errors.code} />
            </Field>
          )}
          <Field label={t.rich("settings.privacy.delete.typeToConfirm", { word: "DELETE", code: (text) => <span className="font-mono font-semibold" dir="ltr">{text}</span> })} htmlFor="delete-confirm" required error={errors.confirm}>
            <Input
              id="delete-confirm"
              name="confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              invalid={!!errors.confirm}
            />
          </Field>
        </form>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={close} disabled={pending}>
            {t("settings.privacy.delete.keep")}
          </Button>
          <Button type="submit" form="delete-account" variant="danger" loading={pending} disabled={confirm.trim().toUpperCase() !== "DELETE"}>
            {t("settings.privacy.delete.button")}
          </Button>
        </div>
      </Dialog>
    </>
  );
}
