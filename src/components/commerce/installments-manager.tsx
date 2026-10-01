"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { CourseInstallmentPlan } from "@/lib/types";
import { installmentPlanAction, remindInstallmentPlansAction, saveCourseInstallmentsAction, setInstallmentsEnabledAction, type InstallmentPlanOp } from "@/lib/actions/payments";
import {
  DEFAULT_INSTALLMENT_INTERVAL_DAYS,
  INSTALLMENT_GRACE_DAYS,
  MAX_INSTALLMENTS,
  MAX_INSTALLMENT_INTERVAL_DAYS,
  MAX_INSTALLMENT_SURCHARGE,
  MIN_INSTALLMENTS,
  installmentOffer,
  intervalPhrase,
  validateInstallmentInput,
  type InstallmentOffer,
  type InstallmentPlanStatus,
} from "@/lib/commerce/installments";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatDate } from "@/lib/utils";
import { money } from "./order-summary";
import { Pager } from "./pager";

/** A running (or finished) payment plan in the admin table. Plain data. */
export interface InstallmentRowData {
  key: string;
  userName: string;
  userEmail: string;
  courseTitle: string;
  status: InstallmentPlanStatus;
  statusLabel: string;
  total: number;
  paidCount: number;
  partAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  currency: string;
  nextNumber: number | null;
  nextDueAt: string | null;
  overdueDays: number;
  pausesAt: string | null;
  autoCharge: boolean;
  gatewayLabel: string;
  startedAt: string;
}

/** A paid course and the terms it is sold with in installments. */
export interface InstallmentCourseData {
  id: string;
  slug: string;
  title: string;
  published: boolean;
  price: number;
  currency: string;
  plan: CourseInstallmentPlan | null;
  offer: InstallmentOffer | null;
  openPlans: number;
}

export interface InstallmentFilterValues {
  status: string;
  course: string;
  q: string;
}

const STATUS_TONE: Record<InstallmentPlanStatus, BadgeTone> = {
  awaiting_first: "neutral",
  on_track: "success",
  overdue: "warning",
  paused: "danger",
  completed: "info",
  cancelled: "neutral",
};

const STATUS_OPTIONS = [
  { value: "open", label: "Collecting payments" },
  { value: "all", label: "All plans" },
  { value: "on_track", label: "On track" },
  { value: "overdue", label: "Payment overdue" },
  { value: "paused", label: "Access paused" },
  { value: "completed", label: "Paid in full" },
  { value: "cancelled", label: "Cancelled" },
  { value: "awaiting_first", label: "Awaiting first payment" },
];

const OPEN: readonly InstallmentPlanStatus[] = ["on_track", "overdue", "paused"];

function filterQuery(values: InstallmentFilterValues, page?: number): string {
  const qs = new URLSearchParams({ tab: "installments" });
  if (values.status && values.status !== "open") qs.set("istatus", values.status);
  if (values.course) qs.set("icourse", values.course);
  if (values.q.trim()) qs.set("iq", values.q.trim());
  if (page && page > 1) qs.set("ipage", String(page));
  return qs.toString();
}

/** "Offer installments" switch: the "or N payments of X" option at checkout for courses that have terms. */
export function InstallmentSalesSwitch({ enabled, gatewayCollects }: { enabled: boolean; gatewayCollects: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    setOn(next);
    startTransition(async () => {
      const res = await setInstallmentsEnabledAction(next);
      if (res.ok) toast.success(res.message ?? "Saved");
      else {
        setOn(!next);
        toast.error("The setting could not be saved", res.error);
      }
    });
  };
  return (
    <Switch
      id="installments-enabled"
      checked={on}
      disabled={pending}
      onChange={(e) => change(e.target.checked)}
      label="Offer installments"
      description={
        !on
          ? "Checkout only takes full payments. Plans already running keep collecting their payments."
          : gatewayCollects
            ? "Courses with installment terms show “or N payments of X” on their page and at checkout."
            : "Installments are on, but no payment gateway is active, so checkout cannot offer them yet."
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Running plans                                                       */
/* ------------------------------------------------------------------ */

function InstallmentFilters({ values, courses }: { values: InstallmentFilterValues; courses: { id: string; title: string }[] }) {
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

  const apply = (next: Partial<InstallmentFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    startTransition(() => router.replace(`${pathname}?${filterQuery(merged)}`, { scroll: false }));
  };
  const onSearch = (value: string) => {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply({ q: value }), 300);
  };
  const hasFilters = values.status !== "open" || !!values.course || !!values.q;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search payment plans"
        placeholder="Search learner, email, course or order"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select aria-label="Filter by status" value={values.status} onChange={(e) => apply({ status: e.target.value })} options={STATUS_OPTIONS} />
      <Select aria-label="Filter by course" value={values.course} onChange={(e) => apply({ course: e.target.value })} options={[{ value: "", label: "Any course" }, ...courses.map((c) => ({ value: c.id, label: c.title }))]} />
      <Button
        variant="ghost"
        disabled={!hasFilters}
        onClick={() => {
          if (timer.current) clearTimeout(timer.current);
          setSearch("");
          apply({ status: "open", course: "", q: "" });
        }}
      >
        Clear
      </Button>
    </div>
  );
}

function nextLine(row: InstallmentRowData): string {
  if (row.status === "completed") return "Every payment made";
  if (row.status === "cancelled") return "Nothing more is collected";
  if (row.status === "awaiting_first") return "Checkout not completed";
  if (!row.nextNumber || !row.nextDueAt) return "";
  const due = formatDate(row.nextDueAt);
  if (row.status === "paused") return `Payment ${row.nextNumber} due ${due} · ${row.overdueDays} days late`;
  if (row.status === "overdue") return `Payment ${row.nextNumber} due ${due} · pauses ${formatDate(row.pausesAt ?? undefined)}`;
  return `Payment ${row.nextNumber} on ${due}${row.autoCharge ? " · charged automatically" : ""}`;
}

const CONFIRM: Record<"cancel" | "waive", { title: string; body: (row: InstallmentRowData) => string; confirm: string; destructive: boolean }> = {
  cancel: {
    title: "Cancel this payment plan?",
    body: (row) =>
      `No more payments are collected from ${row.userName}${row.autoCharge ? " (the Stripe subscription is stopped)" : ""}. They keep their progress, but the lessons of ${row.courseTitle} lock until they buy the course. Payments already made are not refunded.`,
    confirm: "Cancel plan",
    destructive: true,
  },
  waive: {
    title: "Waive the remaining payments?",
    body: (row) => `${money(row.outstandingAmount, row.currency)} still owed by ${row.userName} is written off and ${row.courseTitle} becomes theirs for good. The learner is told by email.`,
    confirm: "Waive payments",
    destructive: false,
  },
};

/** Admin list of payment plans: filters, urgency order, reminders (single and bulk), waive and cancel. */
export function InstallmentPlansTable({
  rows,
  total,
  page,
  pageCount,
  filter,
  courses,
  planCount,
}: {
  rows: InstallmentRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: InstallmentFilterValues;
  courses: { id: string; title: string }[];
  /** Plans in total, whatever the filters. */
  planCount: number;
}) {
  const toast = useToast();
  const [busy, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<{ row: InstallmentRowData; op: "cancel" | "waive" } | null>(null);

  const remindable = rows.filter((r) => OPEN.includes(r.status));
  const selectedKeys = remindable.filter((r) => selected.has(r.key)).map((r) => r.key);
  const allSelected = remindable.length > 0 && selectedKeys.length === remindable.length;

  const act = (row: InstallmentRowData, op: InstallmentPlanOp) =>
    startTransition(async () => {
      const res = await installmentPlanAction(row.key, op);
      if (res.ok) toast.success(res.message ?? "Done");
      else toast.error("The payment plan could not be updated", res.error);
      setConfirming(null);
    });

  const remindSelected = () =>
    startTransition(async () => {
      const res = await remindInstallmentPlansAction(selectedKeys);
      if (res.ok) {
        toast.success(res.message ?? "Reminders sent");
        setSelected(new Set());
      } else toast.error("No reminders were sent", res.error);
    });

  if (planCount === 0) {
    return (
      <EmptyState
        icon={<Icon.Calendar />}
        title="No payment plans yet"
        description="When a learner chooses to pay a course in installments, their plan shows up here with its schedule, what is still owed and any late payment."
      />
    );
  }

  return (
    <div className="space-y-4">
      <InstallmentFilters values={filter} courses={courses} />

      {selectedKeys.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-ink">
            {selectedKeys.length} selected
            <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
              Clear
            </button>
          </p>
          <Button size="sm" variant="outline" loading={busy} onClick={remindSelected} leftIcon={<Icon.Mail className="size-4" />}>
            Send payment reminders
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">No payment plans match these filters</p>
          <p className="mt-1 text-sm text-ink-muted">Try another search, or clear the filters to see every plan.</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-8">
                <input
                  type="checkbox"
                  aria-label="Select all running plans on this page"
                  className="size-4 cursor-pointer rounded border-border-strong accent-accent disabled:cursor-not-allowed"
                  checked={allSelected}
                  disabled={remindable.length === 0}
                  onChange={(e) => setSelected(e.target.checked ? new Set(remindable.map((r) => r.key)) : new Set())}
                />
              </TH>
              <TH>Learner</TH>
              <TH className="hidden md:table-cell">Progress</TH>
              <TH className="text-right">Outstanding</TH>
              <TH>Status</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => {
              const open = OPEN.includes(row.status);
              return (
                <TR key={row.key}>
                  <TD>
                    {open && (
                      <input
                        type="checkbox"
                        aria-label={`Select the plan of ${row.userName}`}
                        className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                        checked={selected.has(row.key)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.key);
                            else next.delete(row.key);
                            return next;
                          })
                        }
                      />
                    )}
                  </TD>
                  <TD className="max-w-64">
                    <p className="truncate font-medium text-ink">{row.userName}</p>
                    <p className="truncate text-xs text-ink-muted">{row.userEmail || "No account email"}</p>
                    <p className="truncate text-xs text-ink-muted" title={row.courseTitle}>
                      {row.courseTitle}
                    </p>
                    <p className="truncate font-mono text-[11px] text-ink-faint">{row.key}</p>
                  </TD>
                  <TD className="hidden md:table-cell">
                    <p className="whitespace-nowrap text-sm tabular-nums text-ink">
                      {row.paidCount} of {row.total} paid
                    </p>
                    <div className="mt-1 h-1.5 w-28 overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((row.paidCount / Math.max(1, row.total)) * 100)}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-muted">
                      {money(row.partAmount, row.currency)} each · {row.gatewayLabel}
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    <span className="font-medium">{row.outstandingAmount ? money(row.outstandingAmount, row.currency) : "—"}</span>
                    <p className="text-xs text-ink-muted">{money(row.paidAmount, row.currency)} paid</p>
                  </TD>
                  <TD className="max-w-56">
                    <Badge tone={STATUS_TONE[row.status]} dot>
                      {row.statusLabel}
                    </Badge>
                    <p className="mt-1 text-[11px] text-ink-muted">{nextLine(row)}</p>
                  </TD>
                  <TD className="text-right">
                    <Dropdown
                      trigger={
                        <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                          <Icon.MoreHorizontal className="size-4" />
                          <span className="sr-only">Actions for the plan of {row.userName}</span>
                        </span>
                      }
                      items={[
                        { label: "View payments", icon: <Icon.Receipt />, href: `/admin/settings/transactions?search=${encodeURIComponent(row.key)}` },
                        {
                          label: "Send reminder",
                          icon: <Icon.Mail />,
                          description: open ? "Email about the next payment" : "Nothing is due",
                          disabled: !open || busy,
                          onClick: () => act(row, "remind"),
                        },
                        {
                          label: "Waive the rest",
                          icon: <Icon.Gift />,
                          description: open ? "The learner keeps the course" : undefined,
                          disabled: !open || busy,
                          onClick: () => setConfirming({ row, op: "waive" }),
                        },
                        {
                          label: "Cancel plan",
                          icon: <Icon.XCircle />,
                          destructive: true,
                          separator: true,
                          description: open ? "Stop collecting; lessons lock" : undefined,
                          disabled: !open || busy,
                          onClick: () => setConfirming({ row, op: "cancel" }),
                        },
                      ]}
                    />
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, p)}`} label="Payment plan pages" summary={`${total} plan${total === 1 ? "" : "s"}`} />

      <ConfirmDialog
        open={!!confirming}
        onClose={() => (busy ? undefined : setConfirming(null))}
        onConfirm={() => {
          if (confirming) act(confirming.row, confirming.op);
        }}
        loading={busy}
        destructive={confirming ? CONFIRM[confirming.op].destructive : false}
        title={confirming ? CONFIRM[confirming.op].title : "Update payment plan?"}
        description={confirming ? CONFIRM[confirming.op].body(confirming.row) : undefined}
        confirmLabel={confirming ? CONFIRM[confirming.op].confirm : "Confirm"}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-course terms                                                    */
/* ------------------------------------------------------------------ */

function offerLine(offer: InstallmentOffer, currency: string): string {
  const extra = offer.extra > 0 ? ` (${money(offer.extra, currency)} more than paying at once)` : "";
  return `${offer.count} payments of ${money(offer.partAmount, currency)}, ${intervalPhrase(offer.intervalDays)}${extra}`;
}

function TermsForm({ course, onDone }: { course: InstallmentCourseData; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(saveCourseInstallmentsAction, { onSuccess: onDone });
  // "Offer" opens with the switch on; switching it off withdraws the terms.
  const [offered, setOffered] = useState(true);
  const [count, setCount] = useState(String(course.plan?.count ?? 3));
  const [intervalDays, setIntervalDays] = useState(String(course.plan?.intervalDays ?? DEFAULT_INSTALLMENT_INTERVAL_DAYS));
  const [surcharge, setSurcharge] = useState(String(course.plan?.surchargePercent ?? 0));

  const parsed = validateInstallmentInput({ count, intervalDays, surchargePercent: surcharge });
  const preview = parsed.ok ? installmentOffer(course.price, course.currency, parsed.plan) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <input type="hidden" name="courseId" value={course.id} />
      {formError && !Object.keys(errors).length && <FormError message={formError} />}

      <p className="text-sm text-ink-muted">
        List price <strong className="text-ink">{money(course.price, course.currency)}</strong>
        {course.openPlans > 0 && ` · ${course.openPlans} running plan${course.openPlans === 1 ? "" : "s"} keep their own schedule whatever you change here.`}
      </p>

      <div className="rounded-lg border border-border px-4 py-3">
        <Switch id="installments-offered" name="offered" checked={offered} onChange={(e) => setOffered(e.target.checked)} label="Sell this course in installments" />
      </div>

      {offered && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Payments" htmlFor="installments-count" error={errors.count ?? (!parsed.ok ? parsed.errors.count : undefined)} hint={`${MIN_INSTALLMENTS} to ${MAX_INSTALLMENTS}`} required>
              <Input id="installments-count" name="count" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} invalid={!!errors.count} />
            </Field>
            <Field
              label="Days between payments"
              htmlFor="installments-interval"
              error={errors.intervalDays ?? (!parsed.ok ? parsed.errors.intervalDays : undefined)}
              hint={`1 to ${MAX_INSTALLMENT_INTERVAL_DAYS}`}
              required
            >
              <Input id="installments-interval" name="intervalDays" inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} invalid={!!errors.intervalDays} />
            </Field>
            <Field
              label="Surcharge %"
              htmlFor="installments-surcharge"
              error={errors.surchargePercent ?? (!parsed.ok ? parsed.errors.surchargePercent : undefined)}
              hint={`0 to ${MAX_INSTALLMENT_SURCHARGE}, added to the price`}
            >
              <Input id="installments-surcharge" name="surchargePercent" inputMode="decimal" value={surcharge} onChange={(e) => setSurcharge(e.target.value)} invalid={!!errors.surchargePercent} />
            </Field>
          </div>
          <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink" aria-live="polite">
            {preview ? (
              <>
                Learners see <strong>or {offerLine(preview, course.currency)}</strong>. Access starts with the first payment and pauses when a payment is more than {INSTALLMENT_GRACE_DAYS} days late.
              </>
            ) : (
              "Fix the values above to preview what learners see."
            )}
          </p>
        </>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Which paid courses can be paid in installments, and on what terms. */
export function InstallmentCoursesTable({ courses, salesEnabled }: { courses: InstallmentCourseData[]; salesEnabled: boolean }) {
  const [editing, setEditing] = useState<InstallmentCourseData | null>(null);
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const visible = q ? courses.filter((c) => c.title.toLowerCase().includes(q)) : courses;
  const offered = courses.filter((c) => c.plan).length;

  if (courses.length === 0) {
    return (
      <EmptyState icon={<Icon.CreditCard />} title="No paid courses" description="Installments split the price of a paid course. Give a course a price in the course editor to offer it in installments." />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {offered} of {courses.length} paid course{courses.length === 1 ? "" : "s"} sold in installments
          {!salesEnabled && offered > 0 && " (hidden while installments are switched off)"}
        </p>
        {courses.length > 8 && (
          <div className="sm:w-64">
            <Input type="search" aria-label="Search paid courses" placeholder="Search courses" value={search} onChange={(e) => setSearch(e.target.value)} leftAddon={<Icon.Search className="size-4" />} />
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-card border border-dashed border-border-strong px-6 py-8 text-center text-sm text-ink-muted">No paid course matches “{search.trim()}”.</p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Course</TH>
              <TH>Installments</TH>
              <TH className="hidden text-right sm:table-cell">Running plans</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((course) => (
              <TR key={course.id}>
                <TD className="max-w-64">
                  <p className="truncate font-medium text-ink">{course.title}</p>
                  <p className="text-xs text-ink-muted tabular-nums">
                    {money(course.price, course.currency)}
                    {!course.published && " · unpublished"}
                  </p>
                </TD>
                <TD className="max-w-72">
                  {course.offer ? (
                    <span className="text-sm text-ink">{offerLine(course.offer, course.currency)}</span>
                  ) : (
                    <span className="text-sm text-ink-muted">Full payment only</span>
                  )}
                </TD>
                <TD className="hidden text-right tabular-nums sm:table-cell">{course.openPlans || "—"}</TD>
                <TD className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEditing(course)}>
                    {course.plan ? "Edit" : "Offer"}
                    <span className="sr-only"> installments for {course.title}</span>
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Installments · ${editing.title}` : "Installments"} size="md">
        {editing && <TermsForm key={editing.id} course={editing} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
