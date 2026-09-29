"use client";

import { useState } from "react";
import { cancelOrderAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useFormAction } from "@/components/admin/settings/use-form-action";

/** Opens the browser's print dialog ("Save as PDF" is offered there). */
export function PrintButton({ label = "Print / Save as PDF", variant = "outline" }: { label?: string; variant?: "outline" | "primary" }) {
  return (
    <Button variant={variant} size="sm" leftIcon={<Icon.Download className="size-4" />} onClick={() => window.print()} className="print:hidden">
      {label}
    </Button>
  );
}

/** Lets the buyer cancel an order that is still awaiting payment. */
export function CancelOrderButton({ orderId, online = false, gateway }: { orderId: string; online?: boolean; gateway?: string }) {
  const [open, setOpen] = useState(false);
  const { submit, pending } = useFormAction(cancelOrderAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button variant="ghost" size="sm" className="text-danger print:hidden" onClick={() => setOpen(true)}>
        Cancel order
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
        title="Cancel this order?"
        description={
          !online
            ? "Only cancel if you haven't paid yet. You can place a new order at any time."
            : gateway === "razorpay"
              ? "Close any Razorpay payment window you still have open: Razorpay can't cancel it for us. If a payment still goes through, it is matched to this order. You can place a new order at any time."
              : "The open payment page is closed so nothing can be charged for this order. You can place a new order at any time."
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
      />
    </>
  );
}
