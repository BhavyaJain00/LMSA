"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/types";
import { adminMarkEmailVerifiedAction, adminResetTwoFactorAction, adminSendPasswordResetAction, adminSignOutEverywhereAction, unlockAccountAction } from "@/lib/actions/security";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";
import type { MessageKey } from "@/i18n/catalog";

type Key = MessageKey<"account">;

type ActionKey = "unlock" | "reset2fa" | "verify" | "sendReset" | "signOut";

interface ActionSpec {
  label: Key;
  icon: keyof typeof Icon;
  variant: ButtonVariant;
  run: (userId: string) => Promise<ActionResult>;
  /** `description` takes `{ name }`. */
  confirm?: { title: Key; description: Key; confirmLabel: Key; destructive?: boolean };
}

const ACTIONS: Record<ActionKey, ActionSpec> = {
  unlock: { label: "security.admin.unlock", icon: "Unlock", variant: "primary", run: unlockAccountAction },
  verify: {
    label: "security.admin.verify",
    icon: "CheckCircle",
    variant: "outline",
    run: adminMarkEmailVerifiedAction,
    confirm: { title: "security.admin.verifyTitle", description: "security.admin.verifyBody", confirmLabel: "security.admin.verifyConfirm" },
  },
  sendReset: {
    label: "security.admin.sendReset",
    icon: "Mail",
    variant: "outline",
    run: adminSendPasswordResetAction,
    confirm: { title: "security.admin.sendResetTitle", description: "security.admin.sendResetBody", confirmLabel: "security.admin.sendResetConfirm" },
  },
  reset2fa: {
    label: "security.admin.reset2fa",
    icon: "Shield",
    variant: "outline",
    run: adminResetTwoFactorAction,
    confirm: { title: "security.admin.reset2faTitle", description: "security.admin.reset2faBody", confirmLabel: "security.admin.reset2faConfirm", destructive: true },
  },
  signOut: {
    label: "security.admin.signOut",
    icon: "LogOut",
    variant: "outline",
    run: adminSignOutEverywhereAction,
    confirm: { title: "security.admin.signOutTitle", description: "security.admin.signOutBody", confirmLabel: "security.admin.signOutConfirm", destructive: true },
  },
};

/** Admin buttons for one account (which ones show depends on its state). Rendered through `AdminAccountActions`, which provides its messages. */
export function AdminAccountActionsClient({ userId, name, actions, size = "sm" }: { userId: string; name: string; actions: ActionKey[]; size?: "xs" | "sm" }) {
  const router = useRouter();
  const toast = useToast();
  const t = useT("account");
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState<ActionKey | null>(null);
  const [confirming, setConfirming] = useState<ActionKey | null>(null);

  const execute = (key: ActionKey) => {
    setRunning(key);
    startTransition(async () => {
      const result = await ACTIONS[key].run(userId);
      setRunning(null);
      setConfirming(null);
      if (result.ok) toast.success(result.message ?? t("security.admin.done"));
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
            {t(a.label)}
          </Button>
        );
      })}
      {spec?.confirm && confirming && (
        <ConfirmDialog
          open
          onClose={() => setConfirming(null)}
          onConfirm={() => execute(confirming)}
          loading={pending}
          title={t(spec.confirm.title)}
          description={t(spec.confirm.description, { name })}
          confirmLabel={t(spec.confirm.confirmLabel)}
          destructive={spec.confirm.destructive}
        />
      )}
    </div>
  );
}

export type { ActionKey as AdminAccountActionKey };
