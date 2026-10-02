"use client";

import { useState } from "react";
import { cancelOrderAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { useT } from "@/i18n/client";

/** Opens the browser's print dialog ("Save as PDF" is offered there). */
export function PrintButton({ label, variant = "outline" }: { label?: string; variant?: "outline" | "primary" }) {
  const t = useT("account");
  return (
    <Button variant={variant} size="sm" leftIcon={<Icon.Download className="size-4" />} onClick={() => window.print()} className="print:hidden">
      {label ?? t("commerce.order.print")}
    </Button>
  );
}

/** Lets the buyer cancel an order that is still awaiting payment. */
export function CancelOrderButton({ orderId, online = false, gateway }: { orderId: string; online?: boolean; gateway?: string }) {
  const [open, setOpen] = useState(false);
  const t = useT("account");
  const { submit, pending } = useFormAction(cancelOrderAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger print:hidden" onClick={() => setOpen(true)}>
        {t("commerce.order.cancel")}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => (pending ? undefined : setOpen(false))}
        onConfirm={() => {
          const fd = new FormData();
          fd.set("orderId", orderId);
          submit(fd);
        }}
        loading={pending}
        destructive
        title={t("commerce.order.cancelTitle")}
        description={!online ? t("commerce.order.cancelManual") : gateway === "razorpay" ? t("commerce.order.cancelRazorpay") : t("commerce.order.cancelStripe")}
        confirmLabel={t("commerce.order.cancel")}
        cancelLabel={t("commerce.order.keep")}
      />
    </>
  );
}
