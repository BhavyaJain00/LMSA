"use client";

import { useId, useState, useTransition } from "react";
import type { TeamUserView } from "@/lib/growth/teams";
import { addManagerAction, removeManagerAction, renameTeamAction, transferOwnershipAction } from "@/lib/actions/teams";
import { MAX_TEAM_MANAGERS, TEAM_NAME_MAX } from "@/lib/growth/teams-shared";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { RoleBadge } from "./team-badges";

/** Rename a team (owner and administrators). */
export function TeamNameForm({ orgId, name }: { orgId: string; name: string }) {
  const id = useId();
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(renameTeamAction);
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <input type="hidden" name="orgId" value={orgId} />
      <div className="min-w-0 flex-1">
        <label htmlFor={`${id}-name`} className="sr-only">
          Team name
        </label>
        <Input id={`${id}-name`} name="name" defaultValue={name} maxLength={TEAM_NAME_MAX} invalid={!!errors.name} aria-describedby={`${id}-hint`} autoComplete="organization" />
        <p id={`${id}-hint`} className={errors.name ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-muted"}>
          {errors.name ?? "Shown in invitations and to your team members."}
        </p>
      </div>
      <Button type="submit" variant="outline" loading={pending} disabled={!dirty}>
        Save name
      </Button>
    </form>
  );
}

/**
 * Who manages the team. The owner (and administrators) add managers by their
 * account email and remove them; a manager can step down themselves.
 */
export function TeamManagers({
  orgId,
  owner,
  managers,
  viewerId,
  canEdit,
  canTransfer,
}: {
  orgId: string;
  owner: TeamUserView | null;
  managers: TeamUserView[];
  viewerId: string;
  /** Owner or administrator: may add and remove managers. */
  canEdit: boolean;
  /** Owner or administrator: may hand the team to another account. */
  canTransfer: boolean;
}) {
  const id = useId();
  const toast = useToast();
  const [removing, setRemoving] = useState<TeamUserView | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [busy, startTransition] = useTransition();
  const { onSubmit, pending, errors, formError, state } = useFormAction(addManagerAction);

  const remove = (user: TeamUserView) =>
    startTransition(async () => {
      const result = await removeManagerAction(orgId, user.id);
      setRemoving(null);
      if (result.ok) toast.success(result.message ?? "Manager removed");
      else toast.error(result.error);
    });

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-border rounded-lg border border-border">
        <li className="flex items-center gap-3 px-3 py-2.5">
          <Avatar name={owner?.name ?? "?"} src={owner?.avatarUrl} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-ink">{owner?.name ?? "Deleted account"}</span>
              <RoleBadge role="owner" />
            </p>
            <p className="truncate text-xs text-ink-muted">{owner?.email ?? "Ask an administrator to assign a new owner."}</p>
          </div>
          {canTransfer && (
            <Button size="xs" variant="ghost" onClick={() => setTransferring(true)}>
              Transfer
            </Button>
          )}
        </li>
        {managers.map((user) => (
          <li key={user.id} className="flex items-center gap-3 px-3 py-2.5">
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-ink">{user.name}</span>
                <RoleBadge role="manager" />
              </p>
              <p className="truncate text-xs text-ink-muted">{user.email}</p>
            </div>
            {(canEdit || user.id === viewerId) && (
              <Button size="xs" variant="ghost" onClick={() => setRemoving(user)} aria-label={user.id === viewerId ? "Stop managing this team" : `Remove ${user.name} as manager`}>
                {user.id === viewerId ? "Step down" : "Remove"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canEdit && managers.length < MAX_TEAM_MANAGERS && (
        <form key={state?.ok ? managers.length : "form"} onSubmit={onSubmit} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <input type="hidden" name="orgId" value={orgId} />
          <div className="min-w-0 flex-1">
            <label htmlFor={`${id}-manager`} className="sr-only">
              New manager&apos;s account email
            </label>
            <Input id={`${id}-manager`} name="email" type="email" placeholder="colleague@company.com" maxLength={200} invalid={!!errors.email} autoComplete="off" aria-describedby={`${id}-manager-hint`} />
            <p id={`${id}-manager-hint`} className={errors.email ? "mt-1.5 text-xs text-danger" : "mt-1.5 text-xs text-ink-muted"}>
              {errors.email ?? "Managers invite members, assign seats and see progress. They need an account first."}
            </p>
          </div>
          <Button type="submit" variant="outline" loading={pending} leftIcon={<Icon.UserPlus className="size-4" />}>
            Add manager
          </Button>
        </form>
      )}
      {formError && !errors.email && <FormError message={formError} />}

      <ConfirmDialog
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        onConfirm={() => {
          if (removing) remove(removing);
        }}
        loading={busy}
        destructive
        title={removing?.id === viewerId ? "Stop managing this team?" : `Remove ${removing?.name ?? "this manager"}?`}
        description={removing?.id === viewerId ? "You lose access to the team's seats and progress. The owner can add you again." : "They can no longer invite members or see the team's progress. Their own seat, if they have one, is not affected."}
        confirmLabel={removing?.id === viewerId ? "Step down" : "Remove"}
      />
      <Dialog open={transferring} onClose={() => setTransferring(false)} title="Transfer ownership" description="The new owner can add managers and buy seats. The current owner stays on as a manager." size="sm">
        {transferring && <TransferForm orgId={orgId} onClose={() => setTransferring(false)} />}
      </Dialog>
    </div>
  );
}

function TransferForm({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const id = useId();
  const { onSubmit, pending, errors, formError } = useFormAction(transferOwnershipAction, { onSuccess: onClose });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <Field label="New owner's account email" htmlFor={`${id}-owner`} required error={errors.email}>
        <Input id={`${id}-owner`} name="email" type="email" maxLength={200} invalid={!!errors.email} autoComplete="off" required />
      </Field>
      <FormError message={formError && !errors.email ? formError : null} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Transfer team
        </Button>
      </div>
    </form>
  );
}
