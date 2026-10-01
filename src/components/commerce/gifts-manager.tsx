"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sendGiftNowAction, setGiftsEnabledAction, updateGiftAction } from "@/lib/actions/gifts";
import { GIFT_STATUS_LABELS, type GiftStatus } from "@/lib/commerce/gifts";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input, Select, Switch, Textarea } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatDate, formatDateTime, formatPrice } from "@/lib/utils";
import { Pager } from "./pager";

/** One gift as the client lists show it (serialisable). */
export interface GiftRowData {
  id: string;
  code: string;
  itemType: "course" | "bundle" | "plan";
  title: string;
  href: string;
  recipientEmail: string;
  recipientName?: string;
  message?: string;
  sendAt?: string;
  sentAt?: string;
  redeemedAt?: string;
  redeemedByName?: string;
  purchaserName: string;
  purchaserEmail: string;
  orderId: string | null;
  amount: number;
  currency: string;
  status: GiftStatus;
  createdAt: string;
}

const STATUS_TONES: Record<GiftStatus, BadgeTone> = {
  awaiting_payment: "warning",
  scheduled: "info",
  sending: "accent",
  delivered: "success",
  redeemed: "success",
  cancelled: "neutral",
  refunded: "danger",
};

export function GiftStatusBadge({ status }: { status: GiftStatus }) {
  return (
    <Badge tone={STATUS_TONES[status]} dot>
      {GIFT_STATUS_LABELS[status]}
    </Badge>
  );
}

const ITEM_LABELS: Record<GiftRowData["itemType"], string> = { course: "Course", bundle: "Bundle", plan: "Membership" };

function whenLabel(row: GiftRowData): string {
  if (row.redeemedAt) return `Redeemed ${formatDate(row.redeemedAt)}${row.redeemedByName ? ` by ${row.redeemedByName}` : ""}`;
  if (row.sentAt) return `Emailed ${formatDate(row.sentAt)}`;
  if (row.status === "scheduled" && row.sendAt) return `Sends ${formatDateTime(row.sendAt)}`;
  if (row.status === "awaiting_payment") return "Sent once the payment is confirmed";
  if (row.status === "sending") return "Sending now";
  return `Ordered ${formatDate(row.createdAt)}`;
}

/** Copy text to the clipboard with a toast. */
function useCopy() {
  const toast = useToast();
  return async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.error("Could not copy", "Select the text and copy it by hand.");
    }
  };
}

function redeemLink(code: string): string {
  return `${window.location.origin}/redeem?code=${encodeURIComponent(code)}`;
}

/** Change the recipient, message or date of a gift that was not delivered yet. */
function EditGiftForm({ row, onDone }: { row: GiftRowData; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(updateGiftAction, { onSuccess: onDone });
  const [day, setDay] = useState(row.sendAt ? row.sendAt.slice(0, 10) : "");
  const sendAt = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m) return "";
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0, 0).toISOString();
  })();
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="giftId" value={row.id} />
      <input type="hidden" name="sendAt" value={sendAt} />
      {formError && !Object.keys(errors).length && <FormError message={formError} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Recipient's name" htmlFor="edit-recipientName" error={errors.recipientName}>
          <Input id="edit-recipientName" name="recipientName" defaultValue={row.recipientName ?? ""} maxLength={80} invalid={!!errors.recipientName} />
        </Field>
        <Field label="Recipient's email" htmlFor="edit-recipientEmail" error={errors.recipientEmail} required>
          <Input id="edit-recipientEmail" name="recipientEmail" type="email" defaultValue={row.recipientEmail} maxLength={254} invalid={!!errors.recipientEmail} />
        </Field>
      </div>
      <Field label="Personal message" htmlFor="edit-message" error={errors.message}>
        <Textarea id="edit-message" name="message" rows={3} defaultValue={row.message ?? ""} maxLength={600} invalid={!!errors.message} />
      </Field>
      <Field label="Send on" htmlFor="edit-day" error={errors.sendAt} hint={errors.sendAt ? undefined : "Leave empty to send it right away (once paid). Delivered around 9:00 your time."}>
        <Input id="edit-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} invalid={!!errors.sendAt} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Save gift
        </Button>
      </div>
    </form>
  );
}

/** The buyer's gifts on /gift: status, code and link to share, send now / resend, edit before delivery. */
export function MyGiftsList({ rows }: { rows: GiftRowData[] }) {
  const toast = useToast();
  const copy = useCopy();
  const [editing, setEditing] = useState<GiftRowData | null>(null);
  const [busy, startTransition] = useTransition();
  const send = (row: GiftRowData) =>
    startTransition(async () => {
      const res = await sendGiftNowAction(row.id);
      if (res.ok) toast.success(res.message ?? "Sent");
      else toast.error("The gift could not be sent", res.error);
    });

  return (
    <>
      <ul className="space-y-3">
        {rows.map((row) => {
          const shareable = row.status === "scheduled" || row.status === "sending" || row.status === "delivered";
          const editable = row.status === "scheduled" || row.status === "awaiting_payment";
          return (
            <li key={row.id} className="rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <GiftStatusBadge status={row.status} />
                    <span className="text-xs text-ink-muted">{ITEM_LABELS[row.itemType]}</span>
                  </div>
                  <Link href={row.href} className="mt-1.5 block truncate font-semibold text-ink hover:text-accent hover:underline">
                    {row.title}
                  </Link>
                  <p className="mt-0.5 truncate text-sm text-ink-muted">
                    For {row.recipientName ? `${row.recipientName} · ` : ""}
                    {row.recipientEmail}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">{whenLabel(row)}</p>
                  {row.message && <p className="mt-2 line-clamp-2 border-l-2 border-border pl-2 text-sm italic text-ink-muted">“{row.message}”</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {row.status === "scheduled" && (
                    <Button size="sm" variant="outline" loading={busy} onClick={() => send(row)} leftIcon={<Icon.Send className="size-4" />}>
                      Send now
                    </Button>
                  )}
                  {row.status === "delivered" && (
                    <Button size="sm" variant="outline" loading={busy} onClick={() => send(row)} leftIcon={<Icon.Refresh className="size-4" />}>
                      Resend email
                    </Button>
                  )}
                  {editable && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(row)} leftIcon={<Icon.Edit className="size-4" />}>
                      Edit
                    </Button>
                  )}
                  {row.orderId && (
                    <Link href={`/billing/success/${encodeURIComponent(row.orderId)}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-ink-muted hover:bg-surface-2 hover:text-ink">
                      <Icon.Receipt className="size-4" aria-hidden="true" />
                      Order
                    </Link>
                  )}
                </div>
              </div>
              {shareable && (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-surface-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-xs text-ink-muted">
                    Gift code <span className="ml-1 font-mono text-sm font-semibold tracking-wide text-ink">{row.code}</span>
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => void copy(row.code, "Gift code")} leftIcon={<Icon.Copy className="size-4" />}>
                      Copy code
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void copy(redeemLink(row.code), "Redeem link")} leftIcon={<Icon.Link className="size-4" />}>
                      Copy link
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Edit gift" description="Changes apply to the email that is still to be sent." size="lg">
        {editing && <EditGiftForm key={editing.id} row={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </>
  );
}

/** "Sell gifts" switch on the admin gifts tab. */
export function GiftSalesSwitch({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const res = await setGiftsEnabledAction(next);
      if (res.ok) toast.success(res.message ?? "Saved");
      else {
        setOn(!next);
        toast.error("The setting could not be saved", res.error);
      }
    });
  };
  return (
    <Switch
      id="gifts-enabled"
      checked={on}
      disabled={pending}
      onChange={(e) => change(e.target.checked)}
      label="Sell gifts"
      description={on ? "Courses, bundles and membership plans show “Give as a gift”." : "Gift checkout is closed. Gifts already bought are still delivered and can be redeemed."}
    />
  );
}

export interface GiftFilterValues {
  status: string;
  q: string;
}

const FILTER_OPTIONS = [
  { value: "all", label: "All gifts" },
  ...(Object.keys(GIFT_STATUS_LABELS) as GiftStatus[]).map((s) => ({ value: s, label: GIFT_STATUS_LABELS[s] })),
];

function filterQuery(values: GiftFilterValues, page?: number): string {
  const qs = new URLSearchParams({ tab: "gifts" });
  if (values.status && values.status !== "all") qs.set("gstatus", values.status);
  if (values.q.trim()) qs.set("gq", values.q.trim());
  if (page && page > 1) qs.set("gpage", String(page));
  return qs.toString();
}

function GiftFilters({ values }: { values: GiftFilterValues }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const apply = (next: Partial<GiftFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    startTransition(() => router.replace(`${pathname}?${filterQuery(merged)}`, { scroll: false }));
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search gifts"
        placeholder="Search by item, buyer, recipient, code or order"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => apply({ q: value }), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select aria-label="Filter by status" value={values.status} onChange={(e) => apply({ status: e.target.value })} options={FILTER_OPTIONS} />
      <Button
        variant="ghost"
        disabled={values.status === "all" && !values.q}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setSearch("");
          apply({ status: "all", q: "" });
        }}
      >
        Clear
      </Button>
    </div>
  );
}

/** Admin gifts tab: every gift with filters, paging, and send now / resend. */
export function GiftsManager({ rows, total, page, pageCount, filter, giftCount }: { rows: GiftRowData[]; total: number; page: number; pageCount: number; filter: GiftFilterValues; giftCount: number }) {
  const toast = useToast();
  const copy = useCopy();
  const [busy, startTransition] = useTransition();
  const send = (row: GiftRowData) =>
    startTransition(async () => {
      const res = await sendGiftNowAction(row.id);
      if (res.ok) toast.success(res.message ?? "Sent");
      else toast.error("The gift could not be sent", res.error);
    });

  if (giftCount === 0) {
    return (
      <EmptyState
        icon={<Icon.Gift />}
        title="No gifts yet"
        description="When someone buys a course, bundle or membership for someone else, it appears here with its delivery and redemption status."
      />
    );
  }
  return (
    <div className="space-y-4">
      <GiftFilters values={filter} />
      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No gifts match these filters</p>
          <p className="mt-1 text-sm text-ink-muted">Try another search, or clear the filters.</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Gift</TH>
              <TH className="hidden md:table-cell">From → to</TH>
              <TH className="text-right">Paid</TH>
              <TH>Status</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="max-w-64">
                  <Link href={row.href} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                    {row.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {ITEM_LABELS[row.itemType]} · <span className="font-mono">{row.code}</span>
                  </p>
                  <p className="truncate text-xs text-ink-muted md:hidden">
                    {row.purchaserName} → {row.recipientEmail}
                  </p>
                </TD>
                <TD className="hidden max-w-64 md:table-cell">
                  <p className="truncate text-sm text-ink">{row.purchaserName}</p>
                  <p className="truncate text-xs text-ink-muted">→ {row.recipientName ? `${row.recipientName} · ` : ""}{row.recipientEmail}</p>
                </TD>
                <TD className="whitespace-nowrap text-right tabular-nums">{formatPrice(row.amount, row.currency, "—")}</TD>
                <TD>
                  <GiftStatusBadge status={row.status} />
                  <p className="mt-1 text-[11px] text-ink-muted">{whenLabel(row)}</p>
                </TD>
                <TD className="text-right">
                  <Dropdown
                    trigger={
                      <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                        <Icon.MoreHorizontal className="size-4" />
                        <span className="sr-only">Actions for the gift {row.code}</span>
                      </span>
                    }
                    items={[
                      ...(row.status === "scheduled" ? [{ label: "Send now", icon: <Icon.Send />, onClick: () => send(row), disabled: busy }] : []),
                      ...(row.status === "delivered" ? [{ label: "Resend email", icon: <Icon.Refresh />, onClick: () => send(row), disabled: busy }] : []),
                      { label: "Copy code", icon: <Icon.Copy />, onClick: () => void copy(row.code, "Gift code") },
                      ...(row.orderId ? [{ label: "View order", icon: <Icon.Receipt />, href: `/admin/settings/transactions?search=${encodeURIComponent(row.orderId)}` }] : []),
                    ]}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, p)}`} label="Gift pages" summary={`${total} gift${total === 1 ? "" : "s"}`} />
    </div>
  );
}
