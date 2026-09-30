"use client";

import { useId, useState, useTransition } from "react";
import type { SeatView } from "@/lib/growth/teams";
import { reassignSeatAction, resendInvitesAction, revokeSeatsAction } from "@/lib/actions/teams";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown, type DropdownItem } from "@/components/ui/dropdown";
import { Icon } from "@/components/ui/icons";
import { Field, FormError, Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { RoleBadge, SeatStateBadge } from "./team-badges";
import { plural } from "@/components/catalog/format";
import { formatDate } from "@/lib/utils";

type Pending = { kind: "revoke" | "resend"; ids: string[]; members: number } | null;

const label = (seat: SeatView) => seat.user?.name ?? seat.email;
const isOpenInvite = (seat: SeatView) => seat.state === "invited" || seat.state === "expired";

/**
 * Seats of a team with row selection, bulk "send again" / "revoke" and a
 * per-seat menu (send again, reassign, revoke). Revoked seats are listed
 * for reference only.
 */
export function TeamSeatsTable({ orgId, rows, emptyText }: { orgId: string; rows: SeatView[]; emptyText: string }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Pending>(null);
  const [reassign, setReassign] = useState<SeatView | null>(null);
  const [busy, startTransition] = useTransition();

  const selectable = rows.filter((r) => r.state !== "revoked");
  const chosen = selectable.filter((r) => selected.has(r.id));
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;
  const resendable = chosen.filter(isOpenInvite).map((r) => r.id);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (pending: NonNullable<Pending>) =>
    startTransition(async () => {
      const result = pending.kind === "revoke" ? await revokeSeatsAction(orgId, pending.ids) : await resendInvitesAction(orgId, pending.ids);
      setConfirm(null);
      if (result.ok) {
        toast.success(result.message ?? "Done");
        setSelected(new Set());
      } else {
        toast.error(result.error);
      }
    });

  const revoke = (seats: SeatView[]) => setConfirm({ kind: "revoke", ids: seats.map((s) => s.id), members: seats.filter((s) => s.state === "active").length });

  return (
    <div className="space-y-3">
      {chosen.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-1/95 px-3 py-2 shadow-card backdrop-blur">
          <p className="mr-auto text-sm text-ink" aria-live="polite">
            {chosen.length} selected
          </p>
          <Button size="sm" variant="outline" onClick={() => run({ kind: "resend", ids: resendable, members: 0 })} disabled={!resendable.length || busy}>
            Send again{resendable.length ? ` (${resendable.length})` : ""}
          </Button>
          <Button size="sm" variant="danger" onClick={() => revoke(chosen)} disabled={busy}>
            Revoke
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} disabled={busy}>
            Clear
          </Button>
        </div>
      )}

      <Table>
        <THead>
          <tr>
            <TH className="w-10">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-accent"
                aria-label="Select every seat on this page"
                checked={allSelected}
                disabled={!selectable.length}
                onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
              />
            </TH>
            <TH>Member</TH>
            <TH>Status</TH>
            <TH className="hidden md:table-cell">Assigned</TH>
            <TH className="w-12">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>{emptyText}</TableEmpty>
          ) : (
            rows.map((seat) => {
              const revoked = seat.state === "revoked";
              const items: DropdownItem[] = [];
              if (isOpenInvite(seat)) items.push({ label: "Send invitation again", icon: <Icon.Send />, onClick: () => run({ kind: "resend", ids: [seat.id], members: 0 }) });
              if (!revoked) {
                items.push({ label: "Give seat to someone else", icon: <Icon.Refresh />, onClick: () => setReassign(seat) });
                items.push({ label: seat.state === "active" ? "Revoke seat" : "Cancel invitation", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => revoke([seat]) });
              }
              return (
                <TR key={seat.id} className={revoked ? "opacity-60" : undefined}>
                  <TD>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Select the seat of ${label(seat)}`}
                      checked={selected.has(seat.id) && !revoked}
                      disabled={revoked}
                      onChange={() => toggle(seat.id)}
                    />
                  </TD>
                  <TD className="max-w-0 w-full">
                    <div className="flex min-w-0 items-center gap-3">
                      {seat.user ? <Avatar name={seat.user.name} src={seat.user.avatarUrl} size="sm" /> : <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-faint"><Icon.Mail className="size-4" aria-hidden="true" /></span>}
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5">
                          <span className="truncate font-medium text-ink">{label(seat)}</span>
                          <RoleBadge role={seat.role} />
                        </p>
                        <p className="truncate text-xs text-ink-muted">
                          {seat.user ? seat.user.email : seat.state === "expired" ? "Link expired" : seat.expiresAt ? `Link works until ${formatDate(seat.expiresAt)}` : "Invitation"}
                          {seat.user && seat.user.email.toLowerCase() !== seat.email.toLowerCase() && ` · invited as ${seat.email}`}
                        </p>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <SeatStateBadge state={seat.state} />
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted md:table-cell">{formatDate(seat.activatedAt ?? seat.assignedAt)}</TD>
                  <TD>
                    {items.length > 0 && (
                      <Dropdown
                        trigger={
                          <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                            <Icon.MoreHorizontal className="size-4" aria-hidden="true" />
                            <span className="sr-only">Actions for the seat of {label(seat)}</span>
                          </span>
                        }
                        items={items}
                      />
                    )}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      <ConfirmDialog
        open={confirm?.kind === "revoke"}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => {
          if (confirm) run(confirm);
        }}
        loading={busy}
        destructive
        title={confirm && confirm.ids.length > 1 ? `Revoke ${confirm.ids.length} seats?` : "Revoke this seat?"}
        description={
          confirm && confirm.members > 0
            ? `${confirm.members === 1 ? "This member loses" : `${confirm.members} members lose`} access to the team's courses and their progress in courses they haven't finished. Finished courses and courses they bought themselves stay. The ${plural(confirm.ids.length, "seat")} can be given to someone else.`
            : "The invitation link stops working and the seat becomes free again."
        }
        confirmLabel="Revoke"
      />
      <Dialog open={reassign !== null} onClose={() => setReassign(null)} title="Give this seat to someone else" description={reassign ? `Currently assigned to ${label(reassign)}.` : undefined} size="sm">
        {reassign && <ReassignForm orgId={orgId} seat={reassign} onClose={() => setReassign(null)} />}
      </Dialog>
    </div>
  );
}

function ReassignForm({ orgId, seat, onClose }: { orgId: string; seat: SeatView; onClose: () => void }) {
  const id = useId();
  const { onSubmit, pending, errors, formError } = useFormAction(reassignSeatAction, { onSuccess: onClose });
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="seatId" value={seat.id} />
      <Field label="New member's email" htmlFor={`${id}-email`} required error={errors.email} hint="We email them an invitation right away.">
        <Input id={`${id}-email`} name="email" type="email" autoComplete="off" maxLength={200} invalid={!!errors.email} required />
      </Field>
      {seat.state === "active" && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink">
          {label(seat)} loses access to the team&apos;s courses and their progress in courses they haven&apos;t finished.
        </p>
      )}
      <FormError message={formError && !Object.keys(errors).length ? formError : null} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Reassign seat
        </Button>
      </div>
    </form>
  );
}
