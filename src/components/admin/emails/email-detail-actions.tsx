"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEmailAction, resendEmailAction, retryEmailAction } from "@/lib/actions/email-settings";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Retry now / Resend / Delete for one outbox message. */
export function EmailDetailActions({
  id,
  canRetry,
  canResend,
  canDelete,
  status,
}: {
  id: string;
  canRetry: boolean;
  canResend: boolean;
  canDelete: boolean;
  status: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"resend" | "delete" | null>(null);
  const [retrying, startRetry] = useTransition();
  const [busy, startBusy] = useTransition();

  const retry = () =>
    startRetry(async () => {
      const result = await retryEmailAction(id);
      if (result.ok) toast.success(result.message ?? "Email sent");
      else toast.error("Delivery failed", result.error);
      router.refresh();
    });

  const onConfirm = () =>
    startBusy(async () => {
      if (confirm === "delete") {
        const result = await deleteEmailAction(id);
        if (result.ok) {
          toast.success(result.message ?? "Email deleted");
          setConfirm(null);
          router.push("/admin/emails");
          router.refresh();
        } else {
          toast.error("Couldn't delete the email", result.error);
          setConfirm(null);
        }
        return;
      }
      const result = await resendEmailAction(id);
      setConfirm(null);
      if (result.ok) {
        toast.success(result.message ?? "A new copy was queued");
        if (result.data.id) router.push(`/admin/emails/${result.data.id}`);
        router.refresh();
      } else {
        toast.error("Couldn't resend", result.error);
        router.refresh();
      }
    });

  return (
    <>
      {canRetry && (
        <Button onClick={retry} loading={retrying} leftIcon={<Icon.Refresh className="size-4" />}>
          {status === "queued" ? "Send now" : "Retry now"}
        </Button>
      )}
      {canResend && (
        <Button variant="outline" onClick={() => setConfirm("resend")} leftIcon={<Icon.Send className="size-4" />}>
          Resend
        </Button>
      )}
      {canDelete && (
        <Button variant="outline" onClick={() => setConfirm("delete")} leftIcon={<Icon.Trash className="size-4" />} className="hover:text-danger">
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={onConfirm}
        loading={busy}
        destructive={confirm === "delete"}
        title={confirm === "delete" ? "Delete this email?" : "Send a new copy?"}
        description={
          confirm === "delete"
            ? "The message is removed from the outbox. If it is still queued, it will not be sent."
            : "A new copy of this email is created and delivered to the same recipients right away. The original stays in the outbox."
        }
        confirmLabel={confirm === "delete" ? "Delete" : "Resend"}
      />
    </>
  );
}
