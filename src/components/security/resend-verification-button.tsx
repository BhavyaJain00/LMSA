"use client";

import { useState, useTransition } from "react";
import { resendVerificationEmailAction } from "@/lib/actions/security";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Sends a fresh verification link (rate-limited on the server). */
export function ResendVerificationButton({ variant = "outline", size = "sm", label = "Resend confirmation email" }: { variant?: ButtonVariant; size?: ButtonSize; label?: string }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  const resend = () =>
    startTransition(async () => {
      const result = await resendVerificationEmailAction();
      if (result.ok) {
        setSent(true);
        toast.success(result.message ?? "Confirmation email sent.");
      } else {
        toast.error(result.error);
      }
    });

  return (
    <Button variant={variant} size={size} onClick={resend} loading={pending} leftIcon={sent ? <Icon.Check className="size-4" /> : <Icon.Mail className="size-4" />}>
      {sent ? "Sent — send again" : label}
    </Button>
  );
}
