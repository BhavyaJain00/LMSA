"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { PaymentItemType, PaymentStatus } from "@/lib/types";
import { deletePaymentAction, markPaymentPaidAction, refundPaymentAction } from "@/lib/actions/payments";
import { Button, ButtonLink } from "@/components/ui/button";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatPrice } from "@/lib/utils";
import { DetailItem } from "@/components/admin/settings/settings-ui";

export interface TransactionView {
  id: string;
  orderId: string;
  userId: string;
  userName: string;
  userEmail: string;
  username: string | null;
  itemType: PaymentItemType;
  itemId: string;
  itemTitle: string;
  itemHref: string | null;
  originalAmount: number;
  discountAmount: number;
  taxAmount: number;
  amount: number;
  currency: string;
  couponCode?: string;
  billingName: string;
  address?: { line1: string; line2?: string; city: string; state?: string; country: string; pincode?: string };
  gstin?: string;
  pan?: string;
  source?: string;
  gateway: string;
  gatewayLabel: string;
  gatewayPaymentId?: string;
  status: PaymentStatus;
  createdAt: string;
  paidAt?: string;
}

const STATUS: Record<PaymentStatus, { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "success" },
  pending: { label: "Unpaid", tone: "warning" },
  failed: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "danger" },
};

const TYPE_LABEL: Record<PaymentItemType, string> = { course: "Course", batch: "Batch", certificate: "Certificate" };

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}

function money(cents: number, currency: string) {
  return formatPrice(cents, currency, formatZero(currency));
}

function formatZero(currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(0);
  } catch {
    return `${currency} 0.00`;
  }
}

export function TransactionsTable({ rows, total, loadMoreHref }: { rows: TransactionView[]; total: number; loadMoreHref: string | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  return (
    <>
      <Table>
        <THead>
          <tr>
            <TH>Billing Name</TH>
            <TH className="hidden md:table-cell">Item</TH>
            <TH className="text-right">Amount</TH>
            <TH>Status</TH>
            <TH className="hidden lg:table-cell">Date</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TableEmpty colSpan={5}>No transactions match these filters.</TableEmpty>
          ) : (
            rows.map((r) => (
              <TR
                key={r.id}
                clickable
                tabIndex={0}
                aria-label={`Open order ${r.orderId}`}
                onClick={() => setOpenId(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpenId(r.id);
                  }
                }}
              >
                <TD>
                  <p className="truncate font-medium">{r.billingName}</p>
                  <p className="truncate text-xs text-ink-muted">{r.userEmail || r.userName}</p>
                  <p className="truncate font-mono text-[11px] text-ink-faint">{r.orderId}</p>
                </TD>
                <TD className="hidden max-w-72 md:table-cell">
                  <p className="truncate">{r.itemTitle}</p>
                  <p className="text-xs text-ink-muted">
                    {TYPE_LABEL[r.itemType]}
                    {r.couponCode && <> · {r.couponCode}</>}
                  </p>
                </TD>
                <TD className="whitespace-nowrap text-right font-medium tabular-nums">{money(r.amount, r.currency)}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <PaymentStatusBadge status={r.status} />
                    {r.itemType === "certificate" && <Badge tone="info">Certificate</Badge>}
                  </div>
                </TD>
                <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(r.createdAt)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        <span>
          Showing {rows.length} of {total}
        </span>
        {loadMoreHref && (
          <ButtonLink href={loadMoreHref} variant="outline" size="sm">
            Load more
          </ButtonLink>
        )}
      </div>
      {open && <TransactionDialog key={open.id} tx={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

type PendingAction = "paid" | "refund" | "delete" | null;

function TransactionDialog({ tx, onClose }: { tx: TransactionView; onClose: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const [busy, startTransition] = useTransition();

  const run = (kind: Exclude<PendingAction, null>) => {
    startTransition(async () => {
      if (kind === "paid") {
        const res = await markPaymentPaidAction(tx.id);
        if (res.ok) {
          toast.success(res.message ?? "Marked as paid", res.data.notice);
          setConfirm(null);
        } else toast.error(res.error);
      } else if (kind === "refund") {
        const res = await refundPaymentAction(tx.id);
        if (res.ok) {
          toast.success(res.message ?? "Refunded");
          setConfirm(null);
        } else toast.error(res.error);
      } else {
        const res = await deletePaymentAction(tx.id);
        if (res.ok) {
          toast.success(res.message ?? "Transaction deleted successfully");
          setConfirm(null);
          onClose();
        } else toast.error(res.error);
      }
    });
  };

  const address = tx.address ? [tx.address.line1, tx.address.line2, tx.address.city, tx.address.state, tx.address.pincode, tx.address.country].filter(Boolean).join(", ") : null;

  return (
    <>
      <Dialog
        open
        onClose={() => (busy ? undefined : onClose())}
        size="lg"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Order <span className="font-mono">{tx.orderId}</span>
            <PaymentStatusBadge status={tx.status} />
          </span>
        }
        description={`${TYPE_LABEL[tx.itemType]} · placed ${formatDateTime(tx.createdAt)}`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {tx.itemHref && (
                <ButtonLink href={tx.itemHref} variant="ghost" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
                  {tx.itemType === "batch" ? "Open the Batch" : "Open the Course"}
                </ButtonLink>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {tx.status !== "paid" && (
                <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirm("delete")} disabled={busy}>
                  Delete
                </Button>
              )}
              {tx.status === "paid" && (
                <Button variant="outline" size="sm" onClick={() => setConfirm("refund")} disabled={busy}>
                  Refund
                </Button>
              )}
              {(tx.status === "pending" || tx.status === "failed") && (
                <Button size="sm" onClick={() => setConfirm("paid")} disabled={busy} leftIcon={<Icon.Check className="size-4" />}>
                  Mark as paid
                </Button>
              )}
            </div>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="rounded-xl bg-surface-2 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Payment for {TYPE_LABEL[tx.itemType]}</p>
            <p className="mt-0.5 font-medium text-ink">{tx.itemTitle}</p>
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-ink-muted">Original amount</dt>
                <dd className="tabular-nums">{money(tx.originalAmount, tx.currency)}</dd>
              </div>
              {tx.discountAmount > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Discount{tx.couponCode ? ` (${tx.couponCode})` : ""}</dt>
                  <dd className="tabular-nums text-success">− {money(tx.discountAmount, tx.currency)}</dd>
                </div>
              )}
              {tx.taxAmount > 0 && (
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-muted">Tax</dt>
                  <dd className="tabular-nums">{money(tx.taxAmount, tx.currency)}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{money(tx.amount, tx.currency)}</dd>
              </div>
            </dl>
          </div>

          <dl className="grid gap-4 sm:grid-cols-2">
            <DetailItem label="Member">
              {tx.userEmail ? (
                <Link href={`/admin/members/${tx.userId}`} className="text-accent hover:underline">
                  {tx.userName}
                </Link>
              ) : (
                tx.userName
              )}
              {tx.userEmail && <span className="block text-xs text-ink-muted">{tx.userEmail}</span>}
            </DetailItem>
            <DetailItem label="Billing name">{tx.billingName}</DetailItem>
            <DetailItem label="Billing address">{address ?? "—"}</DetailItem>
            <DetailItem label="Source">{tx.source ?? "—"}</DetailItem>
            <DetailItem label="Gateway">{tx.gatewayLabel}</DetailItem>
            <DetailItem label="Payment ID">{tx.gatewayPaymentId ? <span className="font-mono text-xs">{tx.gatewayPaymentId}</span> : "—"}</DetailItem>
            <DetailItem label="Paid at">{tx.paidAt ? formatDateTime(tx.paidAt) : "—"}</DetailItem>
            {(tx.gstin || tx.pan) && (
              <DetailItem label="GSTIN / PAN">
                {tx.gstin ?? "—"} / {tx.pan ?? "—"}
              </DetailItem>
            )}
          </dl>

          {tx.status === "pending" && tx.gateway === "manual" && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
              <Icon.Clock className="mt-0.5 size-4 shrink-0 text-warning" />
              This order is awaiting a manual payment. Mark it as paid once the money has arrived — the learner is enrolled immediately.
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirm === "paid"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => run("paid")}
        loading={busy}
        title="Mark this order as paid?"
        description={`${tx.userName} will get access to “${tx.itemTitle}” right away and be notified.`}
        confirmLabel="Mark as paid"
      />
      <ConfirmDialog
        open={confirm === "refund"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => run("refund")}
        loading={busy}
        destructive
        title="Refund this order?"
        description={`The order is marked as refunded and ${tx.userName} loses the access it granted${tx.itemType === "certificate" ? " (the paid certificate is revoked)" : ""}. Send the money back through your payment provider separately.`}
        confirmLabel="Refund"
      />
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => run("delete")}
        loading={busy}
        destructive
        title="Delete this transaction?"
        description="This will permanently delete this payment record, including its billing details. This cannot be undone."
        confirmLabel="Delete"
      />
    </>
  );
}
