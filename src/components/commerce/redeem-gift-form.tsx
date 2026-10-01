"use client";

import { redeemGiftAction } from "@/lib/actions/gifts";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/**
 * Redeem a gift code. With `fixedCode` the code is already known (from the
 * gift email link) and only the confirm button is shown.
 */
export function RedeemGiftForm({ defaultCode = "", fixedCode, label = "Redeem gift" }: { defaultCode?: string; fixedCode?: string; label?: string }) {
  const { onSubmit, pending, errors, formError } = useFormAction(redeemGiftAction, { toastSuccess: false });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {formError && !errors.code && <FormError message={formError} />}
      {fixedCode ? (
        <input type="hidden" name="code" value={fixedCode} />
      ) : (
        <Field label="Gift code" htmlFor="gift-code" error={errors.code} hint={errors.code ? undefined : "It's in the gift email, e.g. GIFT-8F3K-2Q9Z-7MWD."} required>
          <Input
            id="gift-code"
            name="code"
            defaultValue={defaultCode}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={40}
            className="font-mono uppercase tracking-wide"
            invalid={!!errors.code}
          />
        </Field>
      )}
      {fixedCode && errors.code && <FormError message={errors.code} />}
      <Button type="submit" size="lg" loading={pending} className="w-full" leftIcon={<Icon.Gift className="size-4" />}>
        {label}
      </Button>
    </form>
  );
}
