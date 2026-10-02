"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteMemberAction } from "@/lib/actions/members";
import { IconButton } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/i18n/client";

/**
 * Row actions on the members list (Frappe: 'Go to Profile' and 'Delete user').
 * Rendered above the row's full-width link so they stay clickable.
 */
export function MemberRowActions({ member, canDelete }: { member: { id: string; name: string; username: string }; canDelete: boolean }) {
  const t = useT("admin");
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, startTransition] = useTransition();

  return (
    <div className="relative z-10 flex items-center justify-end gap-0.5">
      <Link
        href={`/user/${member.username}`}
        aria-label={t("members.row.profileNamed", { name: member.name })}
        title={t("members.row.profile")}
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-3 hover:text-ink"
      >
        <Icon.User className="size-4" />
      </Link>
      {canDelete && (
        <IconButton label={t("shared.deleteNamed", { name: member.name })} size="icon-sm" className="hover:text-danger" onClick={() => setConfirm(true)}>
          <Icon.Trash className="size-4" />
        </IconButton>
      )}
      <ConfirmDialog
        open={confirm}
        onClose={() => (busy ? undefined : setConfirm(false))}
        onConfirm={() =>
          startTransition(async () => {
            const res = await deleteMemberAction(member.id);
            // On success the action redirects back to the list with a toast.
            if (res && !res.ok) {
              toast.error(t("members.row.deleteFailed"), res.error);
              setConfirm(false);
            }
          })
        }
        loading={busy}
        destructive
        title={t("members.row.deleteTitle", { name: member.name })}
        description={t("members.row.deleteDescription")}
        confirmLabel={t("shared.delete")}
      />
    </div>
  );
}
