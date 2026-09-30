"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { CommissionRowView } from "@/lib/growth/affiliates-shared";
import { approveCommissionsAction, voidCommissionsAction } from "@/lib/actions/affiliates";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { money } from "@/components/commerce/order-summary";
import { CommissionStatusBadge, FraudFlagBadges } from "./affiliate-badges";
import { cn, formatDate } from "@/lib/utils";

type Pending = { kind: "approve" | "void"; ids: string[] } | null;

/**
 * Commission list with row selection and bulk approve / void. Paid and
 * void rows cannot be selected. Flagged rows (possible self-referrals)
 * are highlighted so they are reviewed before approval.
 */
export function CommissionsTable({ rows, showAffiliate = true, emptyText }: { rows: CommissionRowView[]; showAffiliate?: boolean; emptyText: string }) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Pending>(null);
  const [busy, startTransition] = useTransition();

  const selectable = rows.filter((r) => r.status === "pending" || r.status === "approved");
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.id));
  const approvable = selectedRows.filter((r) => r.status === "pending").map((r) => r.id);
  const voidable = selectedRows.map((r) => r.id);
  const flaggedSelected = selectedRows.filter((r) => r.flags.length > 0).length;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = (pending: NonNullable<Pending>) =>
    startTransition(async () => {
      const result = pending.kind === "approve" ? await approveCommissionsAction(pending.ids) : await voidCommissionsAction(pending.ids);
      setConfirm(null);
      if (result.ok) {
        toast.success(result.message ?? "Done");
        setSelected(new Set());
      } else {
        toast.error(result.error);
      }
    });

  const columns = showAffiliate ? 7 : 6;

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div role="region" aria-label="Bulk actions" className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-1/95 px-3 py-2 shadow-card backdrop-blur">
          <p className="mr-auto text-sm text-ink" aria-live="polite">
            {selected.size} selected
            {flaggedSelected > 0 && <span className="text-danger"> · {flaggedSelected} flagged</span>}
          </p>
          <Button size="sm" onClick={() => setConfirm({ kind: "approve", ids: approvable })} disabled={!approvable.length || busy}>
            Approve{approvable.length ? ` ${approvable.length}` : ""}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: "void", ids: voidable })} disabled={busy}>
            Void
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
                aria-label="Select all unpaid commissions on this page"
                checked={allSelected}
                disabled={!selectable.length}
                onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.id)))}
              />
            </TH>
            <TH>Order</TH>
            {showAffiliate && <TH className="hidden md:table-cell">Affiliate</TH>}
            <TH className="hidden lg:table-cell">Buyer</TH>
            <TH className="hidden sm:table-cell">Date</TH>
            <TH>Status</TH>
            <TH className="text-right">Commission</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={columns}>{emptyText}</TableEmpty>
          ) : (
            rows.map((r) => {
              const canSelect = r.status === "pending" || r.status === "approved";
              return (
                <TR key={r.id} className={cn(r.flags.length > 0 && canSelect && "bg-danger/5")}>
                  <TD>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label={`Select commission for order ${r.orderId}`}
                      checked={selected.has(r.id)}
                      disabled={!canSelect}
                      onChange={() => toggle(r.id)}
                    />
                  </TD>
                  <TD className="max-w-0">
                    <Link href={`/admin/settings/transactions?search=${encodeURIComponent(r.orderId)}`} className="block truncate font-medium text-ink hover:underline">
                      {r.itemTitle}
                    </Link>
                    <p className="truncate text-xs text-ink-muted">
                      {r.orderId} · {money(r.orderAmount, r.currency)}
                      {r.amount < 0 && " · refund adjustment"}
                    </p>
                    {showAffiliate && (
                      <p className="truncate text-xs text-ink-muted md:hidden">
                        {r.affiliateName} ({r.affiliateCode})
                      </p>
                    )}
                    {r.flags.length > 0 && (
                      <div className="mt-1">
                        <FraudFlagBadges flags={r.flags} />
                      </div>
                    )}
                  </TD>
                  {showAffiliate && (
                    <TD className="hidden max-w-0 md:table-cell">
                      <Link href={`/admin/affiliates/${r.affiliateId}`} className="block truncate text-ink hover:underline">
                        {r.affiliateName}
                      </Link>
                      <p className="truncate font-mono text-xs text-ink-muted">{r.affiliateCode}</p>
                    </TD>
                  )}
                  <TD className="hidden max-w-0 lg:table-cell">
                    <p className="truncate">{r.buyerName}</p>
                    <p className="truncate text-xs text-ink-muted">{r.buyerEmail}</p>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-ink-muted sm:table-cell">{formatDate(r.createdAt)}</TD>
                  <TD>
                    <CommissionStatusBadge status={r.status} />
                  </TD>
                  <TD className={cn("whitespace-nowrap text-right font-medium tabular-nums", r.amount < 0 && "text-danger", r.status === "void" && "text-ink-faint line-through")}>
                    {money(r.amount, r.currency)}
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => !busy && setConfirm(null)}
        onConfirm={() => {
          if (confirm) run(confirm);
        }}
        loading={busy}
        destructive={confirm?.kind === "void"}
        title={confirm?.kind === "void" ? `Void ${confirm.ids.length === 1 ? "this commission" : `${confirm?.ids.length} commissions`}?` : `Approve ${confirm?.ids.length === 1 ? "this commission" : `${confirm?.ids.length ?? 0} commissions`}?`}
        description={
          confirm?.kind === "void"
            ? "Voided commissions are never paid. Paid commissions in the selection stay unchanged; the refund corrections of voided sales are voided with them."
            : flaggedSelected > 0
              ? `${flaggedSelected} of the selected commissions look like possible self-referrals. Approved commissions are included in the next payout.`
              : "Approved commissions are included in the affiliate's next payout."
        }
        confirmLabel={confirm?.kind === "void" ? "Void" : "Approve"}
      />
    </div>
  );
}
