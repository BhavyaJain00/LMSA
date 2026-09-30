"use client";

import { useState, useTransition } from "react";
import { revealWebhookSecretAction, rotateWebhookSecretAction } from "@/lib/actions/webhooks";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { SecretValue } from "./webhook-secret";

/** Show, hide and replace the signing secret of an endpoint. Showing it is recorded in the audit log. */
export function WebhookSecretPanel({ endpointId, rotatedAt, pending }: { endpointId: string; rotatedAt: string | null; pending: number }) {
  const toast = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRoll, setConfirmRoll] = useState(false);
  const [working, startWork] = useTransition();

  const reveal = () =>
    startWork(async () => {
      const result = await revealWebhookSecretAction(endpointId);
      if (result.ok) setSecret(result.data.secret);
      else toast.error(result.error);
    });

  const roll = () =>
    startWork(async () => {
      const result = await rotateWebhookSecretAction(endpointId);
      if (result.ok) {
        setSecret(result.data.secret);
        toast.success(result.message ?? "New secret created");
      } else {
        toast.error(result.error);
      }
      setConfirmRoll(false);
    });

  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      {secret ? (
        <SecretValue secret={secret} />
      ) : (
        <code className="block rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-ink-muted" aria-label="Signing secret (hidden)">
          whsec_••••••••••••••••••••••••••••••••
        </code>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {secret ? (
          <Button size="sm" variant="outline" leftIcon={<Icon.EyeOff className="size-4" />} onClick={() => setSecret(null)}>
            Hide
          </Button>
        ) : (
          <Button size="sm" variant="outline" leftIcon={<Icon.Eye className="size-4" />} onClick={reveal} loading={working && !confirmRoll}>
            Show secret
          </Button>
        )}
        <Button size="sm" variant="outline" leftIcon={<Icon.Refresh className="size-4" />} onClick={() => setConfirmRoll(true)} disabled={working}>
          Roll secret
        </Button>
        {rotatedAt && <span className="text-xs text-ink-muted">Last rolled {formatDate(rotatedAt)}</span>}
      </div>
      <p className="text-xs text-ink-muted">
        Every request carries an <code className="text-ink">LL-Signature</code> header computed with this secret. Keep it out of client-side code and version control.
      </p>
      <ConfirmDialog
        open={confirmRoll}
        onClose={() => setConfirmRoll(false)}
        onConfirm={roll}
        loading={working}
        destructive
        title="Roll the signing secret?"
        description={`The current secret stops working at once: requests are signed with the new one from the next delivery${pending ? `, including the ${pending} waiting for a retry` : ""}. Update your receiver right after.`}
        confirmLabel="Roll secret"
      />
    </div>
  );
}
