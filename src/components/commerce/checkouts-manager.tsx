"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveRecoverySettingsAction, sendDueCheckoutRemindersAction, stopCheckoutRemindersAction } from "@/lib/actions/payments";
import { SESSION_STATUS_LABELS, delayLabel, validateRecoverySettings, type SessionStatus } from "@/lib/commerce/checkout-recovery";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, Input, Select, Switch } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatDateTime, formatPrice } from "@/lib/utils";
import { Pager } from "./pager";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/**
 * Checkout reminders: on/off, when they go out (hours after the buyer's last
 * checkout visit) and the discount of the last one, with a live preview of
 * the schedule. Also offers "Send due reminders now".
 */
export function RecoverySettingsForm({
  enabled,
  delaysHours,
  couponPercent,
  emailEnabled,
}: {
  enabled: boolean;
  delaysHours: number[];
  couponPercent: number;
  /** Settings → Email is on (otherwise nothing can be sent). */
  emailEnabled: boolean;
}) {
  const toast = useToast();
  const { onSubmit, pending, errors } = useFormAction(saveRecoverySettingsAction);
  const [on, setOn] = useState(enabled);
  const [delays, setDelays] = useState(delaysHours.join(", "));
  const [percent, setPercent] = useState(String(couponPercent));
  const [running, startRun] = useTransition();
  const dirty = on !== enabled || delays.trim() !== delaysHours.join(", ") || percent.trim() !== String(couponPercent);

  const preview = useMemo(() => validateRecoverySettings({ enabled: on, delays, couponPercent: percent }), [on, delays, percent]);
  const schedule = preview.ok
    ? preview.value.delaysHours.map((h, i, all) => `${delayLabel(h)}${i === all.length - 1 && preview.value.couponPercent > 0 ? ` (with ${preview.value.couponPercent}% off)` : ""}`).join(" · ")
    : null;

  const runNow = () =>
    startRun(async () => {
      const res = await sendDueCheckoutRemindersAction();
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error("Reminders could not be sent", res.error);
    });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <Switch
        id="recovery-enabled"
        name="enabled"
        checked={on}
        onChange={(e) => setOn(e.target.checked)}
        label="Email buyers who don't finish their checkout"
        description={
          on
            ? "Signed-in buyers who leave a checkout without paying get a reminder. Buying the item stops the reminders."
            : "No checkout reminders are sent. Checkouts are still tracked for the report below."
        }
      />
      {on && !emailEnabled && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            Email sending is off, so reminders are not sent.{" "}
            <Link href="/admin/settings/email" className="font-medium text-accent hover:underline">
              Turn it on in Email
            </Link>
          </span>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Send reminders after (hours)"
          htmlFor="recovery-delays"
          error={errors.delays}
          hint={errors.delays ? undefined : "Up to 5 times, counted from the buyer's last checkout visit, e.g. 1, 24, 72."}
        >
          <Input id="recovery-delays" name="delays" value={delays} onChange={(e) => setDelays(e.target.value)} inputMode="numeric" invalid={!!errors.delays} disabled={!on} />
        </Field>
        <Field
          label="Discount in the last reminder (%)"
          htmlFor="recovery-coupon"
          error={errors.couponPercent}
          hint={errors.couponPercent ? undefined : "A single-use code valid for 7 days. 0 sends no code. Memberships that renew never get one."}
        >
          <Input id="recovery-coupon" name="couponPercent" type="number" min={0} max={90} step={1} value={percent} onChange={(e) => setPercent(e.target.value)} invalid={!!errors.couponPercent} disabled={!on} />
        </Field>
      </div>
      {/* Disabled inputs are not posted: keep the values when reminders are switched off. */}
      {!on && (
        <>
          <input type="hidden" name="delays" value={delays} />
          <input type="hidden" name="couponPercent" value={percent} />
        </>
      )}
      {on && schedule && (
        <p className="flex items-start gap-2 text-sm text-ink-muted" aria-live="polite">
          <Icon.Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>Reminders go out {schedule} after the last visit.</span>
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="outline" size="sm" onClick={runNow} loading={running} disabled={!enabled || !emailEnabled || dirty} leftIcon={<Icon.Send className="size-4" />}>
          Send due reminders now
        </Button>
        <Button type="submit" loading={pending} disabled={!dirty}>
          Save reminders
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Checkouts list                                                      */
/* ------------------------------------------------------------------ */

/** One tracked checkout as the admin list shows it (serialisable). */
export interface CheckoutRowData {
  id: string;
  userName: string;
  email: string;
  itemType: string;
  itemTitle: string;
  itemHref: string | null;
  status: SessionStatus;
  startedAt: string;
  lastStepAt: string;
  reminderCount: number;
  lastReminderAt?: string;
  couponSent?: string;
  orderId?: string;
  amount?: number;
  currency?: string;
}

export interface CheckoutFilterValues {
  status: string;
  days: number;
  q: string;
}

const STATUS_TONES: Record<SessionStatus, BadgeTone> = { open: "info", abandoned: "warning", completed: "success", recovered: "accent" };

const STATUS_OPTIONS = [{ value: "all", label: "All checkouts" }, ...(Object.keys(SESSION_STATUS_LABELS) as SessionStatus[]).map((s) => ({ value: s, label: SESSION_STATUS_LABELS[s] }))];

const PERIOD_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "0", label: "All time" },
];

function filterQuery(values: CheckoutFilterValues, page?: number): string {
  const qs = new URLSearchParams({ tab: "checkouts" });
  if (values.status && values.status !== "all") qs.set("cstatus", values.status);
  if (values.days !== 30) qs.set("cdays", String(values.days));
  if (values.q.trim()) qs.set("cq", values.q.trim());
  if (page && page > 1) qs.set("cpage", String(page));
  return qs.toString();
}

function CheckoutFilters({ values }: { values: CheckoutFilterValues }) {
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
  const apply = (next: Partial<CheckoutFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    startTransition(() => router.replace(`${pathname}?${filterQuery(merged)}`, { scroll: false }));
  };
  const filtered = values.status !== "all" || values.days !== 30 || !!values.q;
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_10rem_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search checkouts"
        placeholder="Search by buyer, email, item or code"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => apply({ q: value }), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select aria-label="Filter by status" value={values.status} onChange={(e) => apply({ status: e.target.value })} options={STATUS_OPTIONS} />
      <Select aria-label="Started within" value={String(values.days)} onChange={(e) => apply({ days: Number(e.target.value) })} options={PERIOD_OPTIONS} />
      <Button
        variant="ghost"
        disabled={!filtered}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setSearch("");
          apply({ status: "all", days: 30, q: "" });
        }}
      >
        Clear
      </Button>
    </div>
  );
}

function reminderLabel(row: CheckoutRowData, totalReminders: number): string {
  if (row.reminderCount === 0) return row.status === "completed" ? "Bought without a reminder" : "No reminder yet";
  const sent = `${Math.min(row.reminderCount, totalReminders)} of ${totalReminders} sent`;
  return row.lastReminderAt ? `${sent} · last ${formatDateTime(row.lastReminderAt)}` : sent;
}

/** Admin checkouts tab: every tracked checkout with filters, paging and "stop reminders". */
export function CheckoutsManager({
  rows,
  total,
  page,
  pageCount,
  filter,
  sessionCount,
  totalReminders,
}: {
  rows: CheckoutRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: CheckoutFilterValues;
  /** Checkouts tracked overall (any period), for the empty state. */
  sessionCount: number;
  /** Reminders configured per checkout. */
  totalReminders: number;
}) {
  const toast = useToast();
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  // Only checkouts that still have reminders to come can be stopped.
  const stoppable = (r: CheckoutRowData) => (r.status === "open" || r.status === "abandoned") && r.reminderCount < totalReminders;
  const selectable = rows.filter(stoppable);
  const selectedIds = selectable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = selectable.length > 0 && selectedIds.length === selectable.length;

  const stop = (ids: string[]) =>
    startTransition(async () => {
      const res = await stopCheckoutRemindersAction(ids);
      if (res.ok) {
        toast.success(res.message ?? "Reminders stopped");
        setSelected(new Set());
        router.refresh();
      } else toast.error("Reminders could not be stopped", res.error);
    });

  const copyEmail = async (email: string) => {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email copied");
    } catch {
      toast.error("Could not copy", "Select the text and copy it by hand.");
    }
  };

  if (sessionCount === 0) {
    return (
      <EmptyState
        icon={<Icon.CreditCard />}
        title="No checkouts yet"
        description="Each time a signed-in buyer opens a checkout page it is tracked here, with the reminders sent and whether they bought."
      />
    );
  }

  return (
    <div className="space-y-4">
      <CheckoutFilters values={filter} />

      {selectedIds.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink">
            {selectedIds.length} selected
            <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
              Clear
            </button>
          </p>
          <Button size="sm" variant="outline" loading={busy} onClick={() => stop(selectedIds)} leftIcon={<Icon.XCircle className="size-4" />}>
            Stop reminders
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No checkouts match these filters</p>
          <p className="mt-1 text-sm text-ink-muted">Try another period or search, or clear the filters.</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select every checkout on this page that still gets reminders"
                  className="size-4 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed disabled:opacity-40"
                  checked={allSelected}
                  disabled={selectable.length === 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                />
              </TH>
              <TH>Checkout</TH>
              <TH className="hidden md:table-cell">Buyer</TH>
              <TH>Status</TH>
              <TH className="hidden text-right sm:table-cell">Paid</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD>
                  {stoppable(row) && (
                    <input
                      type="checkbox"
                      aria-label={`Select the checkout of ${row.itemTitle} by ${row.userName}`}
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
                  )}
                </TD>
                <TD className="max-w-64">
                  {row.itemHref ? (
                    <Link href={row.itemHref} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                      {row.itemTitle}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium text-ink">{row.itemTitle}</span>
                  )}
                  <p className="text-xs text-ink-muted">
                    {row.itemType} · last visit {formatDateTime(row.lastStepAt)}
                  </p>
                  <p className="truncate text-xs text-ink-muted md:hidden">
                    {row.userName} · {row.email}
                  </p>
                </TD>
                <TD className="hidden max-w-56 md:table-cell">
                  <p className="truncate text-sm text-ink">{row.userName}</p>
                  <p className="truncate text-xs text-ink-muted">{row.email}</p>
                </TD>
                <TD>
                  <Badge tone={STATUS_TONES[row.status]} dot>
                    {SESSION_STATUS_LABELS[row.status]}
                  </Badge>
                  <p className="mt-1 text-[11px] text-ink-muted">{reminderLabel(row, totalReminders)}</p>
                  {row.couponSent && (
                    <p className="text-[11px] text-ink-muted">
                      Code <span className="font-mono">{row.couponSent}</span>
                    </p>
                  )}
                </TD>
                <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">{row.amount !== undefined && row.currency ? formatPrice(row.amount, row.currency) : "—"}</TD>
                <TD className="text-right">
                  <Dropdown
                    trigger={
                      <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                        <Icon.MoreHorizontal className="size-4" />
                        <span className="sr-only">Actions for the checkout of {row.itemTitle} by {row.userName}</span>
                      </span>
                    }
                    items={[
                      ...(stoppable(row) ? [{ label: "Stop reminders", icon: <Icon.XCircle />, onClick: () => stop([row.id]), disabled: busy }] : []),
                      ...(row.email ? [{ label: "Copy email", icon: <Icon.Copy />, onClick: () => void copyEmail(row.email) }] : []),
                      ...(row.orderId ? [{ label: "View order", icon: <Icon.Receipt />, href: `/admin/settings/transactions?search=${encodeURIComponent(row.orderId)}` }] : []),
                    ]}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, p)}`} label="Checkout pages" summary={`${total} checkout${total === 1 ? "" : "s"}`} />
    </div>
  );
}
