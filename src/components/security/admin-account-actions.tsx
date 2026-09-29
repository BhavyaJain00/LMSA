"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import {
  adminMarkEmailVerifiedAction,
  adminResetTwoFactorAction,
  adminSendPasswordResetAction,
  adminSignOutEverywhereAction,
  unlockAccountAction,
} from "@/lib/actions/security";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

type ActionKey = "unlock" | "reset2fa" | "verify" | "sendReset" | "signOut";

interface ActionSpec {
  label: string;
  icon: keyof typeof Icon;
  variant: ButtonVariant;
  run: (userId: string) => Promise<ActionResult>;
  confirm?: { title: string; description: (name: string) => string; confirmLabel: string; destructive?: boolean };
}

const ACTIONS: Record<ActionKey, ActionSpec> = {
  unlock: { label: "Unlock", icon: "Unlock", variant: "primary", run: unlockAccountAction },
  verify: {
    label: "Mark email confirmed",
    icon: "CheckCircle",
    variant: "outline",
    run: adminMarkEmailVerifiedAction,
    confirm: { title: "Mark email as confirmed?", description: (name) => `Only do this if you know ${name} owns this address.`, confirmLabel: "Mark confirmed" },
  },
  sendReset: {
    label: "Send reset link",
    icon: "Mail",
    variant: "outline",
    run: adminSendPasswordResetAction,
    confirm: { title: "Send a password reset link?", description: (name) => `${name} will get an email with a link that works for 1 hour.`, confirmLabel: "Send link" },
  },
  reset2fa: {
    label: "Reset two-step verification",
    icon: "Shield",
    variant: "outline",
    run: adminResetTwoFactorAction,
    confirm: {
      title: "Reset two-step verification?",
      description: (name) => `Use this when ${name} lost their authenticator app and recovery codes. Their authenticator and codes stop working, they're signed out everywhere and can set it up again after signing in with their password.`,
      confirmLabel: "Reset",
      destructive: true,
    },
  },
  signOut: {
    label: "Sign out everywhere",
    icon: "LogOut",
    variant: "outline",
    run: adminSignOutEverywhereAction,
    confirm: { title: "Sign out on every device?", description: (name) => `${name} will need to log in again on all devices.`, confirmLabel: "Sign out", destructive: true },
  },
};

/** Admin buttons for one account (which ones show depends on its state). */
export function AdminAccountActions({ userId, name, actions, size = "sm" }: { userId: string; name: string; actions: ActionKey[]; size?: "xs" | "sm" }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<ActionKey | null>(null);
  const [confirming, setConfirming] = useState<ActionKey | null>(null);

  const execute = (key: ActionKey) => {
    setRunning(key);
    startTransition(async () => {
      const result = await ACTIONS[key].run(userId);
      setRunning(null);
      setConfirming(null);
      if (result.ok) toast.success(result.message ?? "Done.");
      else toast.error(result.error);
      router.refresh();
    });
  };

  const spec = confirming ? ACTIONS[confirming] : null;

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((key) => {
        const a = ACTIONS[key];
        const IconCmp = Icon[a.icon];
        return (
          <Button
            key={key}
            variant={a.variant}
            size={size}
            loading={pending && running === key}
            disabled={pending && running !== key}
            leftIcon={<IconCmp className="size-4" />}
            onClick={() => (a.confirm ? setConfirming(key) : execute(key))}
          >
            {a.label}
          </Button>
        );
      })}
      {spec?.confirm && confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(null)}
          onConfirm={() => execute(confirming)}
          loading={pending}
          title={spec.confirm.title}
          description={spec.confirm.description(name)}
          confirmLabel={spec.confirm.confirmLabel}
          destructive={spec.confirm.destructive}
        />
      )}
    </div>
  );
}

export type { ActionKey as AdminAccountActionKey };
