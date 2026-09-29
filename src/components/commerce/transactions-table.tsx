"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { PaymentItemType, PaymentStatus } from "@/lib/types";
import {
  deletePaymentAction,
  markPaymentPaidAction,
  refundPaymentAction,
  sendPaymentReminderAction,
  syncPaymentAction,
  updatePaymentDetailsAction,
} from "@/lib/actions/payments";
import { Button, ButtonLink } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icons";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Table, TBody, TD, TH, THead, TR, TableEmpty } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { formatDate, formatDateTime, formatPrice } from "@/lib/utils";
import { DetailItem } from "@/components/admin/settings/settings-ui";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { PaymentStatusBadge } from "./status-badge";

export { PaymentStatusBadge } from "./status-badge";

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
  /** Stripe Checkout Session id or Razorpay order id. */
  gatewayOrderId?: string;
  status: PaymentStatus;
  createdAt: string;
  paidAt?: string;
  /** When the learner was last reminded about this unpaid order (manual or automatic). */
  lastReminderAt?: string;
  invoiceNumber?: string;
  refundId?: string;
  refundedAmount?: number;
  refundedAt?: string;
  failureReason?: string;
  /** Payment page in the Stripe/Razorpay dashboard (external). */
  dashboardUrl: string | null;
  /** Refunds are sent through the gateway API (Stripe/Razorpay payment with a real payment id). */
  refundViaGateway: boolean;
  /** Whether the gateway of this order is configured right now. */
  gatewayConfigured: boolean;
  /** Pending gateway order whose status can be checked with the gateway. */
  canSync: boolean;
}

const TYPE_LABEL: Record<PaymentItemType, string> = {
  course: "Course",
  batch: "Batch",
  certificate: "Certificate",
  plan: "Membership",
  bundle: "Bundle",
  gift: "Gift",
  seats: "Team seats",
};

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

function decimal(cents: number): string {
  return (cents / 100).toFixed(2);
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
                  <p className="truncate font-mono text-[11px] text-ink-faint">
                    {r.orderId}
                    {r.invoiceNumber && <> · {r.invoiceNumber}</>}
                  </p>
                </TD>
                <TD className="hidden max-w-72 md:table-cell">
                  <p className="truncate">{r.itemTitle}</p>
                  <p className="text-xs text-ink-muted">
                    {TYPE_LABEL[r.itemType]} · {r.gatewayLabel}
                    {r.couponCode && <> · {r.couponCode}</>}
                  </p>
                </TD>
                <TD className="whitespace-nowrap text-right font-medium tabular-nums">
                  {money(r.amount, r.currency)}
                  {r.refundedAmount !== undefined && r.refundedAmount > 0 && (
                    <span className="block text-[11px] font-normal text-danger">−{money(r.refundedAmount, r.currency)}</span>
                  )}
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    <PaymentStatusBadge status={r.status} failureReason={r.failureReason} refundedAmount={r.refundedAmount} amount={r.amount} />
                    {r.itemType === "certificate" && <Badge tone="info">Certificate</Badge>}
                  </div>
                  {r.status === "pending" && r.lastReminderAt && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-muted">
                      <Icon.Bell className="size-3" aria-hidden="true" />
                      Reminded {formatDate(r.lastReminderAt, { timeZone: "UTC" })}
                    </p>
                  )}
                </TD>
                {/* UTC keeps the server and browser render identical and matches the UTC date filter. */}
                <TD className="hidden whitespace-nowrap text-ink-muted lg:table-cell">{formatDate(r.createdAt, { timeZone: "UTC" })}</TD>
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

type PendingAction = "paid" | "refund" | "delete" | "remind" | null;

function TransactionDialog({ tx, onClose }: { tx: TransactionView; onClose: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<PendingAction>(null);
  const [editing, setEditing] = useState(false);
  const [busy, startTransition] = useTransition();
  const gatewayName = tx.gateway === "stripe" ? "Stripe" : tx.gateway === "razorpay" ? "Razorpay" : tx.gatewayLabel;
  const online = tx.gateway === "stripe" || tx.gateway === "razorpay";

  const run = (kind: Exclude<PendingAction, null | "refund">) => {
    startTransition(async () => {
      if (kind === "paid") {
        const res = await markPaymentPaidAction(tx.id);
        if (res.ok) {
          toast.success(res.message ?? "Marked as paid", res.data.notice);
          setConfirm(null);
        } else toast.error(res.error);
      } else if (kind === "remind") {
        const res = await sendPaymentReminderAction(tx.id);
        if (res.ok) {
          toast.success(res.message ?? "Reminder sent", `${tx.userName} was notified about order ${tx.orderId}.`);
          setConfirm(null);
        } else toast.error("Reminder not sent", res.error);
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

  const sync = () => {
    startTransition(async () => {
      const res = await syncPaymentAction(tx.id);
      if (res.ok) toast.success(res.message ?? "Status checked");
      else toast.error("Status check failed", res.error);
    });
  };

  const address = tx.address ? [tx.address.line1, tx.address.line2, tx.address.city, tx.address.state, tx.address.pincode, tx.address.country].filter(Boolean).join(", ") : null;
  const invoiceHref = `/billing/invoice/${encodeURIComponent(tx.orderId)}`;
  const refunded = tx.refundedAmount ?? (tx.status === "refunded" ? tx.amount : 0);

  return (
    <>
      <Dialog
        open
        onClose={() => (busy ? undefined : onClose())}
        size="lg"
        title={
          <span className="flex flex-wrap items-center gap-2">
            Order <span className="font-mono">{tx.orderId}</span>
            <PaymentStatusBadge status={tx.status} failureReason={tx.failureReason} refundedAmount={tx.refundedAmount} amount={tx.amount} />
          </span>
        }
        description={`${TYPE_LABEL[tx.itemType]} · placed ${formatDateTime(tx.createdAt)}`}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {!editing && (
                <Button variant="ghost" size="sm" leftIcon={<Icon.Edit className="size-4" />} onClick={() => setEditing(true)} disabled={busy}>
                  Edit details
                </Button>
              )}
              {tx.itemHref && (
                <ButtonLink href={tx.itemHref} variant="ghost" size="sm" leftIcon={<Icon.ExternalLink className="size-4" />}>
                  {tx.itemType === "batch" ? "Open the Batch" : "Open the Course"}
                </ButtonLink>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {tx.status !== "paid" && !tx.invoiceNumber && (
                <Button variant="outline" size="sm" className="text-danger" onClick={() => setConfirm("delete")} disabled={busy}>
                  Delete
                </Button>
              )}
              {tx.canSync && (
                <Button variant="outline" size="sm" leftIcon={<Icon.Refresh className="size-4" />} onClick={sync} loading={busy && confirm === null} disabled={busy}>
                  Check with {gatewayName}
                </Button>
              )}
              {tx.status === "pending" && (
                <Button variant="outline" size="sm" leftIcon={<Icon.Bell className="size-4" />} onClick={() => setConfirm("remind")} disabled={busy}>
                  Send reminder
                </Button>
              )}
              {tx.status === "paid" && (
                <Button variant="outline" size="sm" onClick={() => setConfirm("refund")} disabled={busy} leftIcon={<Icon.Refresh className="size-4" />}>
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
              {refunded > 0 && (
                <div className="flex justify-between gap-3 text-danger">
                  <dt>Refunded{tx.refundedAt ? ` · ${formatDate(tx.refundedAt)}` : ""}</dt>
                  <dd className="tabular-nums">− {money(refunded, tx.currency)}</dd>
                </div>
              )}
            </dl>
          </div>

          {tx.status === "failed" && tx.failureReason && (
            <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-ink">
              <Icon.AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
              <span>
                <span className="font-medium">Payment failed:</span> {tx.failureReason}
              </span>
            </p>
          )}

          {editing ? (
            <EditPaymentDetailsForm tx={tx} onDone={() => setEditing(false)} />
          ) : (
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
              <DetailItem label="Gateway">
                {tx.gatewayLabel}
                {online && !tx.gatewayConfigured && <span className="block text-xs text-warning">Not configured right now</span>}
              </DetailItem>
              {tx.gatewayOrderId && (
                <DetailItem label={tx.gateway === "stripe" ? "Checkout session" : "Gateway order ID"}>
                  <span className="font-mono text-xs">{tx.gatewayOrderId}</span>
                </DetailItem>
              )}
              <DetailItem label="Payment ID">
                {tx.gatewayPaymentId ? (
                  <>
                    <span className="font-mono text-xs">{tx.gatewayPaymentId}</span>
                    {tx.dashboardUrl && (
                      <a href={tx.dashboardUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                        View in {gatewayName} <Icon.ExternalLink className="size-3" aria-hidden="true" />
                      </a>
                    )}
                  </>
                ) : (
                  "—"
                )}
              </DetailItem>
              <DetailItem label="Paid at">{tx.paidAt ? formatDateTime(tx.paidAt) : "—"}</DetailItem>
              {tx.refundId && (
                <DetailItem label="Refund ID">
                  <span className="font-mono text-xs">{tx.refundId}</span>
                </DetailItem>
              )}
              {(tx.status === "pending" || tx.lastReminderAt) && (
                <DetailItem label="Last reminder">{tx.lastReminderAt ? formatDateTime(tx.lastReminderAt) : "Not reminded yet"}</DetailItem>
              )}
              {(tx.gstin || tx.pan) && (
                <DetailItem label="GSTIN / PAN">
                  {tx.gstin ?? "—"} / {tx.pan ?? "—"}
                </DetailItem>
              )}
              <DetailItem label="Invoice">
                {tx.invoiceNumber ? (
                  <Link href={invoiceHref} className="font-mono text-accent hover:underline">
                    {tx.invoiceNumber}
                  </Link>
                ) : (
                  <span className="text-ink-muted">Issued when paid</span>
                )}
              </DetailItem>
              <DetailItem label="Order page">
                <Link href={`/billing/success/${encodeURIComponent(tx.orderId)}`} className="text-accent hover:underline">
                  View as the learner sees it
                </Link>
              </DetailItem>
            </dl>
          )}

          {tx.status === "pending" && !online && (
            <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
              <Icon.Clock className="mt-0.5 size-4 shrink-0 text-warning" />
              This order is awaiting a manual payment. Mark it as paid once the money has arrived — the learner is enrolled immediately.
            </p>
          )}
          {tx.status === "pending" && online && (
            <p className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm text-ink">
              <Icon.CreditCard className="mt-0.5 size-4 shrink-0 text-info" />
              The learner started a {gatewayName} checkout but has not finished paying. It completes automatically when they pay; use &ldquo;Check with {gatewayName}&rdquo; if you
              think it was paid.
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
        description={
          online && tx.status === "pending"
            ? tx.gateway === "razorpay"
              ? `Only do this if you received ${money(tx.amount, tx.currency)} outside Razorpay. Razorpay checkouts can't be closed, so a learner who still has the payment window open could pay again; you are alerted if that happens. ${tx.userName} then gets access to “${tx.itemTitle}”.`
              : `Only do this if you received ${money(tx.amount, tx.currency)} outside ${gatewayName}. The learner's open ${gatewayName} checkout is closed first so they can't pay twice; ${tx.userName} then gets access to “${tx.itemTitle}”.`
            : `${tx.userName} will get access to “${tx.itemTitle}” right away and be notified.`
        }
        confirmLabel="Mark as paid"
      />
      <ConfirmDialog
        open={confirm === "remind"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => run("remind")}
        loading={busy}
        title="Send a payment reminder?"
        description={`${tx.userName} gets a notification asking them to complete the payment of ${money(tx.amount, tx.currency)} for “${tx.itemTitle}”.`}
        confirmLabel="Send reminder"
      />
      {confirm === "refund" && <RefundDialog tx={tx} gatewayName={gatewayName} onClose={() => setConfirm(null)} />}
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => (busy ? undefined : setConfirm(null))}
        onConfirm={() => run("delete")}
        loading={busy}
        destructive
        title="Delete this transaction?"
        description={
          online && tx.status === "pending"
            ? tx.gateway === "razorpay"
              ? "This payment record, including its billing details, is permanently deleted. Razorpay checkouts can't be closed: if the learner still pays in an open window, you are alerted so you can refund it."
              : `The learner's open ${gatewayName} checkout is closed and this payment record, including its billing details, is permanently deleted.`
            : "This will permanently delete this payment record, including its billing details. This cannot be undone."
        }
        confirmLabel="Delete"
      />
    </>
  );
}

/** Refund confirmation with an optional partial amount. */
function RefundDialog({ tx, gatewayName, onClose }: { tx: TransactionView; gatewayName: string; onClose: () => void }) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const remaining = Math.max(0, tx.amount - (tx.refundedAmount ?? 0));
  const [amount, setAmount] = useState(decimal(remaining));
  const [recordOnly, setRecordOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viaGateway = tx.refundViaGateway && !recordOnly;
  const paid = tx.amount > 0;

  const parsed = Number(amount);
  const valid = !paid || (/^\d+(\.\d{1,2})?$/.test(amount.trim()) && parsed > 0 && Math.round(parsed * 100) <= remaining);
  const label = paid && valid ? money(Math.round(parsed * 100), tx.currency) : null;

  const submit = () => {
    if (!valid) {
      setError(`Enter an amount between 0.01 and ${decimal(remaining)}.`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await refundPaymentAction(tx.id, { amount: paid ? amount.trim() : undefined, recordOnly });
      if (res.ok) {
        toast.success(res.message ?? "Refunded");
        onClose();
      } else {
        setError(res.fieldErrors?.amount ?? res.error);
        toast.error("Refund failed", res.error);
      }
    });
  };

  return (
    <Dialog
      open
      onClose={() => (pending ? undefined : onClose())}
      size="sm"
      title={`Refund order ${tx.orderId}?`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={!valid}>
            {viaGateway ? `Refund${label ? ` ${label}` : ""} via ${gatewayName}` : `Record refund${label ? ` of ${label}` : ""}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <p className="text-ink-muted">
          {viaGateway
            ? `The money goes back to ${tx.userName}'s original payment method through ${gatewayName}. It usually arrives within 5–10 business days.`
            : tx.refundViaGateway
              ? `Nothing is sent through ${gatewayName}: use this when you already refunded the payment in the ${gatewayName} dashboard.`
              : "This order was not paid through a payment gateway. Return the money to the learner yourself; this records the refund."}{" "}
          {tx.userName} loses the access this order granted{tx.itemType === "certificate" ? " (the paid certificate is revoked)" : ""}.
        </p>
        {paid && (
          <Field
            label={`Refund amount (${tx.currency.toUpperCase()})`}
            htmlFor={`refund-amount-${tx.id}`}
            error={error ?? undefined}
            hint={`Up to ${money(remaining, tx.currency)}. Lower it for a partial refund.`}
          >
            <Input
              id={`refund-amount-${tx.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^\d.]/g, ""));
                setError(null);
              }}
              invalid={!!error}
              className="tabular-nums"
              autoFocus
            />
          </Field>
        )}
        {!paid && error && <p className="text-xs text-danger">{error}</p>}
        {tx.refundViaGateway && (
          <Checkbox
            id={`refund-record-${tx.id}`}
            checked={recordOnly}
            onChange={(e) => setRecordOnly(e.target.checked)}
            label={`Already refunded in the ${gatewayName} dashboard`}
            description="Only record the refund here without calling the gateway."
          />
        )}
      </div>
    </Dialog>
  );
}

/** Inline form in the transaction dialog for correcting billing details. */
function EditPaymentDetailsForm({ tx, onDone }: { tx: TransactionView; onDone: () => void }) {
  const { onSubmit, pending, errors, dirty, markDirty } = useFormAction(updatePaymentDetailsAction, { onSuccess: onDone });
  const id = `edit-tx-${tx.id}`;
  const lockedId = tx.refundViaGateway;
  return (
    <form onSubmit={onSubmit} onChange={markDirty} noValidate className="space-y-4 rounded-xl border border-border p-4">
      <input type="hidden" name="id" value={tx.id} />
      <p className="text-sm font-semibold text-ink">Edit details</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Billing Name" htmlFor={`${id}-name`} error={errors.billingName} required>
          <Input id={`${id}-name`} name="billingName" defaultValue={tx.billingName} maxLength={140} invalid={!!errors.billingName} autoFocus />
        </Field>
        <Field label="Payment ID" htmlFor={`${id}-pid`} error={errors.gatewayPaymentId} hint={lockedId ? "Set by the payment gateway." : undefined}>
          <Input
            id={`${id}-pid`}
            name="gatewayPaymentId"
            defaultValue={tx.gatewayPaymentId}
            maxLength={120}
            className="font-mono"
            invalid={!!errors.gatewayPaymentId}
            readOnly={lockedId}
          />
        </Field>
        <Field label="Source" htmlFor={`${id}-source`} error={errors.source}>
          <Input id={`${id}-source`} name="source" defaultValue={tx.source} maxLength={80} invalid={!!errors.source} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="GSTIN" htmlFor={`${id}-gstin`} error={errors.gstin}>
            <Input id={`${id}-gstin`} name="gstin" defaultValue={tx.gstin} maxLength={15} className="font-mono uppercase" invalid={!!errors.gstin} />
          </Field>
          <Field label="PAN" htmlFor={`${id}-pan`} error={errors.pan}>
            <Input id={`${id}-pan`} name="pan" defaultValue={tx.pan} maxLength={10} className="font-mono uppercase" invalid={!!errors.pan} />
          </Field>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={pending} disabled={!dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}
