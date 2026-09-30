"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteWebhookEndpointAction, setWebhookActiveAction, updateWebhookEndpointAction } from "@/lib/actions/webhooks";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";
import { DELETE_ENDPOINT_WARNING, turnOffWarning } from "./webhook-copy";
import { WebhookFields } from "./webhook-fields";

export interface EndpointSummary {
  id: string;
  url: string;
  host: string;
  description: string;
  events: string[];
  active: boolean;
  /** Deliveries waiting for a retry (cancelled when the endpoint is turned off). */
  pending: number;
}

function EditEndpointDialog({ endpoint, open, onClose }: { endpoint: EndpointSummary; open: boolean; onClose: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(updateWebhookEndpointAction, { toastError: false, onSuccess: onClose });
  const hasFieldError = Object.keys(errors).length > 0;
  return (
    <Dialog open={open} onClose={onClose} title="Edit endpoint" description="Changes apply to events that happen from now on. Deliveries already waiting for a retry go to the new URL." size="lg">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        <input type="hidden" name="id" value={endpoint.id} />
        <WebhookFields idPrefix="edit-webhook" initial={endpoint} errors={errors} />
        {formError && !hasFieldError && (
          <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
            {formError}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Edit, turn on/off and delete buttons of the endpoint page. */
export function WebhookEndpointActions({ endpoint }: { endpoint: EndpointSummary }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  // Remount the dialog each time it opens so it starts from the saved values.
  const [editKey, setEditKey] = useState(0);
  const [confirm, setConfirm] = useState<"off" | "delete" | null>(null);
  const [working, startWork] = useTransition();

  const setActive = (active: boolean) =>
    startWork(async () => {
      const result = await setWebhookActiveAction(endpoint.id, active);
      if (result.ok) toast.success(result.message ?? "Saved");
      else toast.error(result.error);
      setConfirm(null);
    });

  const remove = () =>
    startWork(async () => {
      const result = await deleteWebhookEndpointAction(endpoint.id);
      if (result.ok) {
        toast.success(result.message ?? "Deleted");
        router.push("/admin/settings/api");
      } else {
        toast.error(result.error);
        setConfirm(null);
      }
    });

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        leftIcon={<Icon.Edit className="size-4" />}
        onClick={() => {
          setEditKey((k) => k + 1);
          setEditing(true);
        }}
      >
        Edit
      </Button>
      {endpoint.active ? (
        <Button size="sm" variant="outline" leftIcon={<Icon.Pause className="size-4" />} onClick={() => setConfirm("off")} disabled={working}>
          Turn off
        </Button>
      ) : (
        <Button size="sm" leftIcon={<Icon.Play className="size-4" />} onClick={() => setActive(true)} loading={working && confirm === null}>
          Turn on
        </Button>
      )}
      <Button size="sm" variant="ghost" className="text-danger" leftIcon={<Icon.Trash className="size-4" />} onClick={() => setConfirm("delete")} disabled={working}>
        Delete
      </Button>

      <EditEndpointDialog key={editKey} endpoint={endpoint} open={editing} onClose={() => setEditing(false)} />
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={() => (confirm === "delete" ? remove() : setActive(false))}
        loading={working}
        destructive
        title={confirm === "delete" ? `Delete the endpoint at ${endpoint.host}?` : `Turn off the endpoint at ${endpoint.host}?`}
        description={confirm === "delete" ? DELETE_ENDPOINT_WARNING : turnOffWarning(endpoint.pending)}
        confirmLabel={confirm === "delete" ? "Delete endpoint" : "Turn off"}
      />
    </>
  );
}
