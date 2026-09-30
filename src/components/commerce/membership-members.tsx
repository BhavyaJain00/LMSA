"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SubscriptionStatus } from "@/lib/types";
import { adminMembershipAction, extendMembershipAction, extendMembershipsAction, grantMembershipAction, type MembershipAdminOp } from "@/lib/actions/plans";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input, Select } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { MemberPicker, type PickerMember } from "@/components/admin/settings/member-picker";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatDate, formatPrice } from "@/lib/utils";

export interface MemberRowData {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  planName: string;
  status: SubscriptionStatus;
  statusLabel: string;
  cancelAtPeriodEnd: boolean;
  gatewayLabel: string;
  /** Billed by Stripe or Razorpay: dates follow the gateway and can't be edited here. */
  gatewayManaged: boolean;
  gatewayName: string | null;
  dashboardUrl: string | null;
  currentPeriodEnd: string;
  createdAt: string;
  paidOrders: number;
  lifetimeValue: number;
  currency: string;
}

export interface MemberFilterValues {
  status: string;
  plan: string;
  gateway: string;
  q: string;
}

const STATUS_TONE: Record<SubscriptionStatus, BadgeTone> = { trialing: "info", active: "success", past_due: "warning", cancelled: "neutral", expired: "neutral" };

const STATUS_OPTIONS = [
  { value: "ongoing", label: "Running memberships" },
  { value: "all", label: "All memberships" },
  { value: "trialing", label: "Free trial" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Payment due" },
  { value: "ending", label: "Ending at period end" },
  { value: "cancelled", label: "Cancelled" },
  { value: "expired", label: "Expired" },
];

const GATEWAY_OPTIONS = [
  { value: "", label: "Any billing" },
  { value: "stripe", label: "Stripe" },
  { value: "razorpay", label: "Razorpay" },
  { value: "manual", label: "Manual payment" },
  { value: "free", label: "Complimentary" },
];

function filterQuery(values: MemberFilterValues, page?: number): string {
  const qs = new URLSearchParams({ tab: "members" });
  if (values.status && values.status !== "ongoing") qs.set("status", values.status);
  if (values.plan) qs.set("plan", values.plan);
  if (values.gateway) qs.set("gateway", values.gateway);
  if (values.q.trim()) qs.set("q", values.q.trim());
  if (page && page > 1) qs.set("page", String(page));
  return qs.toString();
}

/** URL-driven filters of the members table (search, status, plan, billing). */
function MemberFilters({ values, plans }: { values: MemberFilterValues; plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState(values.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (next: Partial<MemberFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    startTransition(() => router.replace(`${pathname}?${filterQuery(merged)}`, { scroll: false }));
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value }), 300);
  };

  const hasFilters = values.status !== "ongoing" || !!values.plan || !!values.gateway || !!values.q;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search members"
        placeholder="Search name, email or subscription ID"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select aria-label="Filter by status" value={values.status} onChange={(e) => apply({ status: e.target.value })} options={STATUS_OPTIONS} />
      <Select aria-label="Filter by plan" value={values.plan} onChange={(e) => apply({ plan: e.target.value })} options={[{ value: "", label: "Any plan" }, ...plans.map((p) => ({ value: p.id, label: p.name }))]} />
      <Select aria-label="Filter by billing" value={values.gateway} onChange={(e) => apply({ gateway: e.target.value })} options={GATEWAY_OPTIONS} />
      <Button
        variant="ghost"
        disabled={!hasFilters}
        onClick={() => {
          setSearch("");
          apply({ status: "ongoing", plan: "", gateway: "", q: "" });
        }}
      >
        Clear
      </Button>
    </div>
  );
}

/** "Grant membership": a complimentary membership for one member. */
export function GrantMembershipButton({ members, plans }: { members: PickerMember[]; plans: { id: string; name: string; active: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errors, formError } = useFormAction(grantMembershipAction, { onSuccess: () => setOpen(false) });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} leftIcon={<Icon.Gift className="size-4" />} disabled={plans.length === 0}>
        Grant membership
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Grant a membership" description="Give a member a plan at no charge, for example after a bank transfer or as a scholarship.">
        {open && (
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {formError && !Object.keys(errors).length && <FormError message={formError} />}
            <Field label="Member" htmlFor="grant-member" error={errors.userId} required>
              <MemberPicker id="grant-member" name="userId" members={members} invalid={!!errors.userId} />
            </Field>
            <Field label="Plan" htmlFor="grant-plan" error={errors.planId} required>
              <Select
                id="grant-plan"
                name="planId"
                defaultValue=""
                placeholder="Select a plan"
                options={plans.map((p) => ({ value: p.id, label: p.active ? p.name : `${p.name} (retired)` }))}
                invalid={!!errors.planId}
              />
            </Field>
            <Field label="Length in days" htmlFor="grant-days" error={errors.days} hint={errors.days ? undefined : "Leave empty for one billing period of the plan (lifetime plans never end)."}>
              <Input id="grant-days" name="days" type="number" min={1} max={3650} step={1} placeholder="e.g. 30" invalid={!!errors.days} />
            </Field>
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Grant membership
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </>
  );
}

/** Add days to a membership that is not billed by a gateway (also reactivates an ended one). */
function ExtendForm({ row, onDone }: { row: MemberRowData; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(extendMembershipAction, { onSuccess: onDone });
  const ended = row.status === "cancelled" || row.status === "expired";
  return (
    <form onSubmit={onSubmit} noValidate className="rounded-lg border border-border p-3">
      <input type="hidden" name="subscriptionId" value={row.id} />
      {formError && !errors.days && (
        <div className="mb-3">
          <FormError message={formError} />
        </div>
      )}
      <Field
        label={ended ? "Reactivate for (days)" : "Extend by (days)"}
        htmlFor="extend-days"
        error={errors.days}
        hint={errors.days ? undefined : ended ? "The membership ended: it becomes active again from today." : `Added after ${formatDate(row.currentPeriodEnd)}.`}
      >
        <div className="flex items-center gap-2">
          <Input id="extend-days" name="days" type="number" min={1} max={3650} step={1} defaultValue={30} invalid={!!errors.days} />
          <Button type="submit" loading={pending} leftIcon={<Icon.Calendar className="size-4" />}>
            {ended ? "Reactivate" : "Extend"}
          </Button>
        </div>
      </Field>
    </form>
  );
}

const CONFIRM_COPY: Record<"cancel_now" | "cancel_at_end", { title: string; confirm: string; body: (row: MemberRowData) => string }> = {
  cancel_now: {
    title: "Cancel this membership now?",
    confirm: "Cancel now",
    body: (row) =>
      `${row.userName} loses access to the courses of ${row.planName} immediately (their progress is kept).${row.gatewayManaged ? ` The ${row.gatewayName} subscription is cancelled too, so nothing more is charged.` : ""} Refund the last payment from Transactions if needed.`,
  },
  cancel_at_end: {
    title: "End this membership at the period end?",
    confirm: "End at period end",
    body: (row) => `${row.userName} keeps access until ${formatDate(row.currentPeriodEnd)} and is not charged again. They are told by email.`,
  },
};

/** Members table of the admin plans page: filters, row actions, bulk extension and paging. */
export function MembershipMembers({
  rows,
  total,
  page,
  pageCount,
  filter,
  plans,
}: {
  rows: MemberRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: MemberFilterValues;
  plans: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const [managing, setManaging] = useState<MemberRowData | null>(null);
  const [confirming, setConfirming] = useState<{ row: MemberRowData; op: "cancel_now" | "cancel_at_end" } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDays, setBulkDays] = useState("7");

  // Selection only covers rows on the current page.
  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;

  const run = (row: MemberRowData, op: MembershipAdminOp, done?: () => void) =>
    startTransition(async () => {
      const res = await adminMembershipAction(row.id, op);
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error("The membership could not be updated", res.error);
      done?.();
    });

  const bulkExtend = () => {
    const days = /^\d{1,4}$/.test(bulkDays.trim()) ? Number(bulkDays) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      toast.error("Enter between 1 and 3650 days");
      return;
    }
    startTransition(async () => {
      const res = await extendMembershipsAction(
        selectedRows.map((r) => r.id),
        days,
      );
      if (res.ok) {
        toast.success(res.message ?? "Extended");
        setSelected(new Set());
      } else toast.error("The memberships could not be extended", res.error);
    });
  };

  const managingEnded = !!managing && (managing.status === "cancelled" || managing.status === "expired");
  /** Confirmations open after the manage dialog closes (one modal at a time). */
  const askConfirm = (row: MemberRowData, op: "cancel_now" | "cancel_at_end") => {
    setManaging(null);
    setConfirming({ row, op });
  };

  return (
    <div className="space-y-4">
      <MemberFilters values={filter} plans={plans} />

      {selectedRows.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink">
            {selectedRows.length} selected
            <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
              Clear
            </button>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="bulk-days" className="text-sm text-ink-muted">
              Extend by
            </label>
            <Input id="bulk-days" type="number" min={1} max={3650} value={bulkDays} onChange={(e) => setBulkDays(e.target.value)} className="w-20" />
            <span className="text-sm text-ink-muted">days</span>
            <Button size="sm" loading={busy} onClick={bulkExtend}>
              Apply
            </Button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">{total === 0 && filter.status === "ongoing" && !filter.plan && !filter.gateway && !filter.q ? "No running memberships yet" : "No memberships match these filters"}</p>
          <p className="mt-1 text-sm text-ink-muted">Members appear here as soon as they start a trial or pay for a plan. You can also grant a membership by hand.</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all memberships on this page"
                  className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </TH>
              <TH>Member</TH>
              <TH>Plan</TH>
              <TH>Status</TH>
              <TH>Period ends</TH>
              <TH>Billing</TH>
              <TH className="text-right">Paid</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  <input
                    type="checkbox"
                    aria-label={`Select the membership of ${row.userName}`}
                    className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                    checked={selected.has(row.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })
                    }
                  />
                </TD>
                <TD>
                  <Link href={`/admin/members/${row.userId}`} className="font-medium text-ink hover:text-accent hover:underline">
                    {row.userName}
                  </Link>
                  <p className="text-xs text-ink-muted">{row.userEmail}</p>
                </TD>
                <TD className="whitespace-nowrap">{row.planName}</TD>
                <TD>
                  <Badge tone={row.cancelAtPeriodEnd && (row.status === "active" || row.status === "trialing") ? "warning" : STATUS_TONE[row.status]} dot>
                    {row.statusLabel}
                  </Badge>
                </TD>
                <TD className="whitespace-nowrap">
                  {formatDate(row.currentPeriodEnd)}
                  <p className="text-xs text-ink-muted">since {formatDate(row.createdAt)}</p>
                </TD>
                <TD className="whitespace-nowrap">{row.gatewayLabel}</TD>
                <TD className="whitespace-nowrap text-right tabular-nums">
                  {formatPrice(row.lifetimeValue, row.currency, "—")}
                  <p className="text-xs text-ink-muted">
                    {row.paidOrders} payment{row.paidOrders === 1 ? "" : "s"}
                  </p>
                </TD>
                <TD className="text-right">
                  <Button variant="outline" size="xs" onClick={() => setManaging(row)} aria-label={`Manage the membership of ${row.userName}`}>
                    Manage
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {pageCount > 1 && (
        <nav aria-label="Members pages" className="flex items-center justify-between gap-3 text-sm">
          <p className="text-ink-muted">
            Page {page} of {pageCount} · {total} membership{total === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            {page > 1 ? (
              <Link href={`?${filterQuery(filter, page - 1)}`} scroll={false} className="rounded-lg border border-border-strong px-3 py-1.5 font-medium text-ink hover:bg-surface-2">
                Previous
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-ink-faint" aria-disabled="true">
                Previous
              </span>
            )}
            {page < pageCount ? (
              <Link href={`?${filterQuery(filter, page + 1)}`} scroll={false} className="rounded-lg border border-border-strong px-3 py-1.5 font-medium text-ink hover:bg-surface-2">
                Next
              </Link>
            ) : (
              <span className="rounded-lg border border-border px-3 py-1.5 text-ink-faint" aria-disabled="true">
                Next
              </span>
            )}
          </div>
        </nav>
      )}

      <Dialog open={!!managing} onClose={() => setManaging(null)} title="Manage membership" description={managing ? `${managing.userName} · ${managing.userEmail}` : undefined}>
        {managing && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 px-3 py-3 text-sm">
              <div>
                <dt className="text-xs text-ink-muted">Plan</dt>
                <dd className="font-medium text-ink">{managing.planName}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Status</dt>
                <dd className="font-medium text-ink">{managing.statusLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">{managingEnded ? "Ended" : "Period ends"}</dt>
                <dd className="font-medium text-ink">{formatDate(managing.currentPeriodEnd)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-muted">Billing</dt>
                <dd className="font-medium text-ink">{managing.gatewayLabel}</dd>
              </div>
            </dl>

            {managing.gatewayManaged ? (
              <p className="flex items-start gap-2 text-sm text-ink-muted">
                <Icon.Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {managing.gatewayName} bills this membership, so its dates follow {managing.gatewayName}. Refresh it if a webhook was missed.
              </p>
            ) : (
              <ExtendForm key={managing.id} row={managing} onDone={() => setManaging(null)} />
            )}

            <div className="flex flex-wrap gap-2">
              {managing.gatewayManaged && (
                <Button variant="outline" size="sm" loading={busy} onClick={() => run(managing, "refresh", () => setManaging(null))} leftIcon={<Icon.Refresh className="size-4" />}>
                  Refresh from {managing.gatewayName}
                </Button>
              )}
              {!managingEnded && managing.cancelAtPeriodEnd && (
                <Button variant="outline" size="sm" loading={busy} onClick={() => run(managing, "resume", () => setManaging(null))} leftIcon={<Icon.CheckCircle className="size-4" />}>
                  Resume renewal
                </Button>
              )}
              {!managingEnded && !managing.cancelAtPeriodEnd && (
                <Button variant="outline" size="sm" onClick={() => askConfirm(managing, "cancel_at_end")} leftIcon={<Icon.Clock className="size-4" />}>
                  End at period end
                </Button>
              )}
              <Link
                href={`/admin/settings/transactions?type=plan&search=${encodeURIComponent(managing.userEmail)}`}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2"
              >
                <Icon.Receipt className="size-4" aria-hidden="true" />
                View orders
              </Link>
              {managing.dashboardUrl && (
                <a
                  href={managing.dashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong px-3 text-sm font-medium text-ink hover:bg-surface-2"
                >
                  <Icon.ExternalLink className="size-4" aria-hidden="true" />
                  Open in {managing.gatewayName}
                </a>
              )}
            </div>

            {!managingEnded && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
                <p className="text-xs text-ink-muted">Ends the membership immediately and locks its courses for the member.</p>
                <Button variant="danger" size="sm" onClick={() => askConfirm(managing, "cancel_now")}>
                  Cancel now
                </Button>
              </div>
            )}
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!confirming}
        onClose={() => (busy ? undefined : setConfirming(null))}
        onConfirm={() => {
          if (confirming) run(confirming.row, confirming.op, () => setConfirming(null));
        }}
        loading={busy}
        destructive={confirming?.op === "cancel_now"}
        title={confirming ? CONFIRM_COPY[confirming.op].title : "Cancel membership?"}
        description={confirming ? CONFIRM_COPY[confirming.op].body(confirming.row) : undefined}
        confirmLabel={confirming ? CONFIRM_COPY[confirming.op].confirm : "Confirm"}
        cancelLabel="Keep membership"
      />
    </div>
  );
}
