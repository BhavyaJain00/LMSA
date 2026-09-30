"use client";

import { useState, useTransition } from "react";
import { setApiEnabledAction } from "@/lib/actions/api-keys";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

/** Site-wide API switch. Turning it off asks for confirmation because live integrations stop at once. */
export function ApiAccessSwitch({ initial, activeKeys }: { initial: boolean; activeKeys: number }) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(initial);
  const [confirmOff, setConfirmOff] = useState(false);
  const [pending, startTransition] = useTransition();

  const save = (next: boolean) => {
    startTransition(async () => {
      const result = await setApiEnabledAction(next);
      if (result.ok) {
        setEnabled(result.data.enabled);
        toast.success(result.message ?? "Saved");
      } else {
        toast.error(result.error);
      }
      setConfirmOff(false);
    });
  };

  return (
    <>
      <Switch
        id="api-enabled"
        checked={enabled}
        disabled={pending}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          if (!next && activeKeys > 0) setConfirmOff(true);
          else save(next);
        }}
        label="Allow API requests"
        description="When off, every request to /api/v1 is refused and webhooks are not sent. Keys stay valid and work again when you turn it back on."
      />
      <ConfirmDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        onConfirm={() => save(false)}
        loading={pending}
        destructive
        title="Turn off the API?"
        description={`${activeKeys} active ${activeKeys === 1 ? "key stops" : "keys stop"} working right away, so connected tools (Zapier, CRMs, scripts) will get errors until you turn the API back on.`}
        confirmLabel="Turn off"
      />
    </>
  );
}
