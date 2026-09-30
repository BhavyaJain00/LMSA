"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/types";
import {
  cancelBroadcastAction,
  deleteBroadcastAction,
  duplicateBroadcastAction,
  pauseBroadcastAction,
  resumeBroadcastAction,
} from "@/lib/actions/broadcasts";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { useToast } from "@/components/ui/toast";

/** Runs a broadcast action, shows its outcome as a toast and refreshes the page data. */
function useBroadcastAction() {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const run = (action: () => Promise<ActionResult>, after?: () => void) =>
    startTransition(async () => {
      try {
        const result = await action();
        // Actions that redirect never return.
        if (!result) return;
        if (result.ok) {
          if (result.message) toast.success(result.message);
          router.refresh();
        } else {
          toast.error(result.error);
        }
      } finally {
        after?.();
      }
    });
  return { pending, run };
}

/**
 * "More" menu of a broadcast (list rows and the detail page): open, edit,
 * duplicate into a new draft, delete.
 */
export function BroadcastMenu({
  id,
  subject,
  editable,
  deletable,
  showOpen,
  variant = "icon",
}: {
  id: string;
  subject: string;
  /** Drafts and scheduled broadcasts can be edited. */
  editable: boolean;
  /** Everything except a broadcast that is actively sending. */
  deletable: boolean;
  /** Include a link to the detail page (list rows). */
  showOpen?: boolean;
  variant?: "icon" | "button";
}) {
  const { pending, run } = useBroadcastAction();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const items: DropdownItem[] = [];
  if (showOpen) items.push({ label: editable ? "Review and send" : "View report", icon: <Icon.Eye />, href: `/admin/broadcasts/${id}` });
  if (editable) items.push({ label: "Edit", icon: <Icon.Edit />, href: `/admin/broadcasts/${id}/edit` });
  items.push({
    label: "Duplicate",
    description: "Copy into a new draft",
    icon: <Icon.Copy />,
    disabled: pending,
    onClick: () => run(() => duplicateBroadcastAction(id)),
  });
  items.push({
    label: "Delete",
    icon: <Icon.Trash />,
    destructive: true,
    separator: true,
    disabled: !deletable || pending,
    description: deletable ? undefined : "Pause or stop the send first",
    onClick: () => setConfirmDelete(true),
  });

  return (
    <>
      <Dropdown
        trigger={
          variant === "icon" ? (
            <span className={buttonClasses({ variant: "ghost", size: "icon-sm" })}>
              <Icon.MoreHorizontal className="size-4" />
              <span className="sr-only">Actions for “{subject}”</span>
            </span>
          ) : (
            <span className={buttonClasses({ variant: "outline" })}>
              <Icon.MoreHorizontal className="size-4" />
              More
            </span>
          )
        }
        items={items}
      />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => run(() => deleteBroadcastAction(id), () => setConfirmDelete(false))}
        title="Delete this broadcast?"
        description={`“${subject}” and its report are removed for good. Emails that were already sent stay in the recipients' inboxes.`}
        confirmLabel="Delete broadcast"
        destructive
        loading={pending}
      />
    </>
  );
}

/** Pause, resume or stop a broadcast that is being sent. */
export function SendingControls({ id, paused, remaining }: { id: string; paused: boolean; remaining: number }) {
  const { pending, run } = useBroadcastAction();
  const [confirmStop, setConfirmStop] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      {paused ? (
        <Button size="sm" loading={pending} onClick={() => run(() => resumeBroadcastAction(id))} leftIcon={<Icon.Play className="size-4" />}>
          Resume sending
        </Button>
      ) : (
        <Button size="sm" variant="outline" loading={pending} onClick={() => run(() => pauseBroadcastAction(id))} leftIcon={<Icon.Pause className="size-4" />}>
          Pause
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmStop(true)} leftIcon={<Icon.XCircle className="size-4" />}>
        Stop sending
      </Button>
      <ConfirmDialog
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={() => run(() => cancelBroadcastAction(id), () => setConfirmStop(false))}
        title="Stop this broadcast?"
        description={`${remaining.toLocaleString("en-US")} ${remaining === 1 ? "person who hasn't" : "people who haven't"} been emailed yet won't receive it. This can't be undone — to reach them later, duplicate the broadcast.`}
        confirmLabel="Stop sending"
        destructive
        loading={pending}
      />
    </div>
  );
}
