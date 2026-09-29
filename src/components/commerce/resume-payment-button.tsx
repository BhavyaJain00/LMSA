"use client";

import { useTransition } from "react";
import { resumeCheckoutAction } from "@/lib/actions/payments";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { launchStatusLabel, useCheckoutLauncher, usePreloadRazorpay } from "./checkout-launcher";

const GATEWAY_NAME: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

/**
 * "Complete payment" / "Try again" for a pending order. The server reopens
 * the gateway checkout (reusing an open Stripe session or Razorpay order) or
 * reports that the payment already went through.
 */
export function ResumePaymentButton({
  orderId,
  gateway,
  label = "Complete payment",
  variant = "primary",
  size = "md",
  className,
  showStatus = true,
}: {
  orderId: string;
  gateway: string;
  label?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  showStatus?: boolean;
}) {
  const toast = useToast();
  const launcher = useCheckoutLauncher();
  const [pending, startTransition] = useTransition();
  usePreloadRazorpay(gateway === "razorpay");
  const busy = pending || launcher.busy;
  const statusLabel = showStatus ? launchStatusLabel(launcher.status, GATEWAY_NAME[gateway] ?? "payment") : null;

  const resume = () => {
    startTransition(async () => {
      const res = await resumeCheckoutAction(orderId);
      if (!res.ok) {
        toast.error("Payment could not continue", res.error);
        return;
      }
      if (res.message) toast.success(res.message);
      await launcher.launch(res.data);
    });
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant={variant} size={size} className={className} loading={busy} onClick={resume} leftIcon={<Icon.CreditCard className="size-4" />}>
        {label}
      </Button>
      {statusLabel && (
        <span className="text-xs text-ink-muted" role="status" aria-live="polite">
          {statusLabel}
        </span>
      )}
    </span>
  );
}
