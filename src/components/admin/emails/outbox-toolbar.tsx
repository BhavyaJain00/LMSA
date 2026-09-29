"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pruneSentEmailsAction, retryAllFailedAction, runDeliveryAction } from "@/lib/actions/email-settings";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { SendTestEmailForm } from "./send-test-email";

/** Page actions of the outbox: run delivery, send a test email, bulk retry and clean-up. */
export function OutboxToolbar({ defaultTestTo, failedCount, canConfigure }: { defaultTestTo: string; failedCount: number; canConfigure: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [testOpen, setTestOpen] = useState(false);
  const [confirm, setConfirm] = useState<"retry" | "prune" | null>(null);
  const [running, startRun] = useTransition();
  const [busy, startBusy] = useTransition();

  const runNow = () =>
    startRun(async () => {
      const result = await runDeliveryAction();
      if (result.ok) toast.success(result.message ?? "Delivery run finished");
      else toast.error("Delivery run failed", result.error);
      router.refresh();
    });

  const onConfirm = () =>
    startBusy(async () => {
      const result = confirm === "retry" ? await retryAllFailedAction() : await pruneSentEmailsAction(30);
      if (result.ok) toast.success(result.message ?? "Done");
      else toast.error("Something went wrong", result.error);
      setConfirm(null);
      router.refresh();
    });

  return (
    <>
      <Button variant="outline" onClick={() => setTestOpen(true)} leftIcon={<Icon.Mail className="size-4" />}>
        Send test email
      </Button>
      <Button onClick={runNow} loading={running} leftIcon={<Icon.Send className="size-4" />}>
        Run delivery now
      </Button>
      <Dropdown
        trigger={
          <span className={buttonClasses({ variant: "outline", size: "icon" })} aria-label="More outbox actions" title="More actions">
            <Icon.MoreHorizontal className="size-4" />
          </span>
        }
        items={[
          { label: "Send a batch email", icon: <Icon.Megaphone />, href: "/admin/emails/compose", description: "Message a batch's students" },
          {
            label: "Retry all failed",
            icon: <Icon.Refresh />,
            onClick: () => setConfirm("retry"),
            disabled: failedCount === 0,
            description: failedCount ? `${failedCount} failed ${failedCount === 1 ? "email" : "emails"}` : "No failed emails",
            separator: true,
          },
          { label: "Delete old sent emails", icon: <Icon.Trash />, onClick: () => setConfirm("prune"), description: "Sent more than 30 days ago", destructive: true },
          ...(canConfigure ? [{ label: "Email settings", icon: <Icon.Settings />, href: "/admin/settings/email", separator: true }] : []),
        ]}
      />
      <Dialog open={testOpen} onClose={() => setTestOpen(false)} title="Send a test email" description="Check delivery, branding and spam placement.">
        {testOpen && <SendTestEmailForm defaultTo={defaultTestTo} autoFocus />}
      </Dialog>
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={onConfirm}
        loading={busy}
        destructive={confirm === "prune"}
        title={confirm === "retry" ? "Retry every failed email?" : "Delete old sent emails?"}
        description={
          confirm === "retry"
            ? "Failed emails are queued again with a fresh set of attempts and delivered right away. Password reset and verification emails are skipped because their links were removed."
            : "Sent emails older than 30 days are removed from the outbox. Queued and failed emails are kept. This cannot be undone."
        }
        confirmLabel={confirm === "retry" ? "Retry failed" : "Delete"}
      />
    </>
  );
}

