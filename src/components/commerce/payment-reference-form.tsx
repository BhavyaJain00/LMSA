"use client";

import { submitPaymentReferenceAction } from "@/lib/actions/payments";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icons";
import { useT } from "@/i18n/client";

/**
 * On a manual order's page: the buyer enters (or corrects) the transaction / UTR reference of their transfer,
 * so an administrator can find the money and confirm the order.
 */
export function PaymentReferenceForm({ orderId, current }: { orderId: string; current?: string }) {
  const t = useT("account");
  const { onSubmit, pending, errors, formError } = useFormAction(submitPaymentReferenceAction);
  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 border-t border-border pt-4">
      <input type="hidden" name="orderId" value={orderId} />
      <Field
        label={t("commerce.manual.reference")}
        htmlFor="order-reference"
        error={errors.reference ?? formError ?? undefined}
        hint={errors.reference || formError ? undefined : t("commerce.manual.referenceAfter")}
      >
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="order-reference"
            name="reference"
            defaultValue={current}
            maxLength={80}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            dir="ltr"
            invalid={!!errors.reference}
          />
          <Button type="submit" loading={pending} className="shrink-0">
            {current ? t("commerce.manual.updateReference") : t("commerce.manual.sendReference")}
          </Button>
        </div>
      </Field>
      {current && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-success" role="status">
          <Icon.CheckCircle className="size-3.5" aria-hidden="true" />
          {t("commerce.manual.referenceReceived")}
        </p>
      )}
    </form>
  );
}
