"use client";

import { useState } from "react";
import { cancelOrderAction } from "@/lib/actions/payments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useFormAction } from "@/components/admin/settings/use-form-action";

export function PrintReceiptButton() {
  return (
    <Button variant="outline" size="sm" leftIcon={<Icon.FileText className="size-4" />} onClick={() => window.print()} className="print:hidden">
      Print receipt
    </Button>
  );
}

/** Lets the buyer cancel an order that is still awaiting confirmation. */
export function CancelOrderButton({ orderId }: { orderId: string }) {
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
        description="Only cancel if you haven't paid yet. You can place a new order at any time."
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
      />
    </>
  );
}
