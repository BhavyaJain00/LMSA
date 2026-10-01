"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { saveUpsellAction, upsellsAction, type UpsellBulkOp } from "@/lib/actions/upsells";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Dropdown } from "@/components/ui/dropdown";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input, Select, Switch } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatPrice } from "@/lib/utils";
import { Pager } from "./pager";

export interface UpsellRowData {
  id: string;
  triggerRef: string;
  offerRef: string;
  triggerTitle: string;
  offerTitle: string;
  triggerHref: string | null;
  offerHref: string | null;
  triggerType: "course" | "bundle";
  offerType: "course" | "bundle";
  discountPercent: number;
  headline: string;
  active: boolean;
  offerPrice: number;
  offerDiscounted: number;
  currency: string;
  currencyMismatch: boolean;
  unavailable: boolean;
  triggerSales: number;
  accepted: number;
  bumps: number;
  postPurchase: number;
  conversionPercent: number;
  revenueLabel: string;
}

export interface UpsellChoice {
  ref: string;
  type: "course" | "bundle";
  title: string;
  price: number;
  currency: string;
  published: boolean;
}

export interface UpsellFilterValues {
  status: string;
  q: string;
}

const TYPE_LABEL = { course: "Course", bundle: "Bundle" } as const;

function filterQuery(values: UpsellFilterValues, page?: number): string {
  const qs = new URLSearchParams();
  if (values.status && values.status !== "all") qs.set("status", values.status);
  if (values.q.trim()) qs.set("q", values.q.trim());
  if (page && page > 1) qs.set("page", String(page));
  return qs.toString();
}

function UpsellFilters({ values }: { values: UpsellFilterValues }) {
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
  const apply = (next: Partial<UpsellFilterValues>) => {
    const merged = { ...values, q: search, ...next };
    const qs = filterQuery(merged);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_auto]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search upsells"
        placeholder="Search by headline, trigger or offer"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const value = e.target.value;
          timer.current = setTimeout(() => apply({ q: value }), 300);
        }}
        leftAddon={pending ? <Spinner className="size-4" /> : <Icon.Search className="size-4" />}
      />
      <Select
        aria-label="Filter by status"
        value={values.status}
        onChange={(e) => apply({ status: e.target.value })}
        options={[
          { value: "all", label: "All upsells" },
          { value: "active", label: "Active" },
          { value: "paused", label: "Paused" },
        ]}
      />
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

function choiceLabel(c: UpsellChoice): string {
  return `${TYPE_LABEL[c.type]} · ${c.title} (${formatPrice(c.price, c.currency)})${c.published ? "" : " · unpublished"}`;
}

function UpsellForm({ upsell, choices, onDone }: { upsell: UpsellRowData | null; choices: UpsellChoice[]; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(saveUpsellAction, { onSuccess: onDone });
  const [trigger, setTrigger] = useState(upsell?.triggerRef ?? "");
  const [offer, setOffer] = useState(upsell?.offerRef ?? "");
  const [discount, setDiscount] = useState(String(upsell?.discountPercent ?? 20));
  const byRef = useMemo(() => new Map(choices.map((c) => [c.ref, c])), [choices]);
  const options = choices.map((c) => ({ value: c.ref, label: choiceLabel(c) }));
  const offerChoice = byRef.get(offer);
  const triggerChoice = byRef.get(trigger);
  const pct = Number(discount);
  const preview = offerChoice && Number.isInteger(pct) && pct >= 0 && pct <= 95 ? Math.round((offerChoice.price * (100 - pct)) / 100) : null;
  const mismatch = !!offerChoice && !!triggerChoice && offerChoice.currency.toUpperCase() !== triggerChoice.currency.toUpperCase();

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {upsell && <input type="hidden" name="id" value={upsell.id} />}
      {formError && !Object.keys(errors).length && <FormError message={formError} />}
      <Field label="When someone buys" htmlFor="upsell-trigger" error={errors.trigger} required>
        <Select id="upsell-trigger" name="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Choose a course or bundle" options={options} invalid={!!errors.trigger} />
      </Field>
      <Field label="Offer them" htmlFor="upsell-offer" error={errors.offer} required>
        <Select id="upsell-offer" name="offer" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="Choose a course or bundle" options={options.filter((o) => o.value !== trigger)} invalid={!!errors.offer} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Discount" htmlFor="upsell-discount" error={errors.discountPercent} required>
          <Input id="upsell-discount" name="discountPercent" inputMode="numeric" value={discount} onChange={(e) => setDiscount(e.target.value)} rightAddon="%" invalid={!!errors.discountPercent} />
        </Field>
        <Field label="Headline" htmlFor="upsell-headline" error={errors.headline} hint={errors.headline ? undefined : "Shown above the offer, e.g. “Add the advanced course and save 30%”."} required>
          <Input id="upsell-headline" name="headline" defaultValue={upsell?.headline ?? ""} maxLength={140} invalid={!!errors.headline} />
        </Field>
      </div>
      {offerChoice && preview !== null && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted" aria-live="polite">
          Buyers pay <strong className="text-ink">{formatPrice(preview, offerChoice.currency)}</strong>
          {pct > 0 && <> instead of {formatPrice(offerChoice.price, offerChoice.currency)}</>} (before tax).
        </p>
      )}
      {mismatch && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          These two items are priced in different currencies, so the offer can't be added to the same payment and won&apos;t be shown.
        </p>
      )}
      <div className="rounded-lg border border-border px-4 py-3">
        <Switch id="upsell-active" name="active" defaultChecked={upsell?.active ?? true} label="Active" description="Show it as an order bump at checkout and as a one-click offer after the purchase." />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {upsell ? "Save upsell" : "Create upsell"}
        </Button>
      </div>
    </form>
  );
}

/** `/admin/upsells`: list with search, status filter, performance, create/edit, bulk activate/pause/delete. */
export function UpsellsManager({
  rows,
  total,
  page,
  pageCount,
  filter,
  choices,
  upsellCount,
}: {
  rows: UpsellRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: UpsellFilterValues;
  choices: UpsellChoice[];
  upsellCount: number;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<UpsellRowData | "new" | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const selectedIds = rows.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = rows.length > 0 && selectedIds.length === rows.length;

  const run = (ids: string[], op: UpsellBulkOp) =>
    startTransition(async () => {
      const res = await upsellsAction(ids, op);
      if (res.ok) {
        toast.success(res.message ?? "Done");
        setSelected(new Set());
      } else toast.error("The upsells could not be updated", res.error);
      setDeleting(null);
    });

  const newButton = (
    <Button size="sm" onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />} disabled={choices.length < 2}>
      New upsell
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {upsellCount === 0 ? "No upsells yet." : `${total} of ${upsellCount} upsell${upsellCount === 1 ? "" : "s"}`}
          {choices.length < 2 && " You need at least two paid courses or bundles first."}
        </p>
        {newButton}
      </div>

      {upsellCount === 0 ? (
        <EmptyState
          icon={<Icon.TrendingUp />}
          title="Create your first upsell"
          description="Offer a second course or bundle at a discount: as a tick box at checkout (order bump) and as a one-click offer right after the purchase."
          action={newButton}
        />
      ) : (
        <>
          <UpsellFilters values={filter} />
          {selectedIds.length > 0 && (
            <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-ink">
                {selectedIds.length} selected
                <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
                  Clear
                </button>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" loading={busy} onClick={() => run(selectedIds, "activate")}>
                  Activate
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(selectedIds, "pause")}>
                  Pause
                </Button>
                <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => setDeleting(selectedIds)}>
                  Delete
                </Button>
              </div>
            </div>
          )}
          {rows.length === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
              <p className="text-sm font-medium text-ink">No upsells match these filters</p>
              <p className="mt-1 text-sm text-ink-muted">Try another search, or clear the filters.</p>
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all upsells on this page"
                      className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    />
                  </TH>
                  <TH>Offer</TH>
                  <TH className="text-right">Price</TH>
                  <TH className="hidden text-right md:table-cell">Results</TH>
                  <TH>Status</TH>
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
                        aria-label={`Select ${row.headline}`}
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
                    <TD className="max-w-80">
                      <button type="button" onClick={() => setEditing(row)} className="block max-w-full truncate text-left font-medium text-ink hover:text-accent hover:underline">
                        {row.headline}
                      </button>
                      <p className="truncate text-xs text-ink-muted">
                        {TYPE_LABEL[row.triggerType]} {row.triggerTitle} → {TYPE_LABEL[row.offerType].toLowerCase()} {row.offerTitle}
                      </p>
                      <p className="text-xs text-ink-muted md:hidden">
                        {row.accepted} accepted · {row.conversionPercent}%
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap text-right tabular-nums">
                      <span className="font-medium">{formatPrice(row.offerDiscounted, row.currency)}</span>
                      <p className="text-xs text-ink-muted">{row.discountPercent > 0 ? `${row.discountPercent}% off ${formatPrice(row.offerPrice, row.currency)}` : "List price"}</p>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-right tabular-nums md:table-cell">
                      <span className="font-medium">{row.revenueLabel}</span>
                      <p className="text-xs text-ink-muted">
                        {row.accepted} of {row.triggerSales} buyers · {row.conversionPercent}%
                      </p>
                      <p className="text-[11px] text-ink-faint">
                        {row.bumps} at checkout · {row.postPurchase} after
                      </p>
                    </TD>
                    <TD>
                      <Badge tone={!row.active ? "neutral" : row.currencyMismatch || row.unavailable ? "warning" : "success"} dot>
                        {!row.active ? "Paused" : row.currencyMismatch || row.unavailable ? "Not shown" : "Active"}
                      </Badge>
                      {row.active && (row.currencyMismatch || row.unavailable) && (
                        <p className="mt-1 text-[11px] text-ink-muted">{row.currencyMismatch ? "Different currencies" : "Offer not on sale"}</p>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Dropdown
                        trigger={
                          <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">
                            <Icon.MoreHorizontal className="size-4" />
                            <span className="sr-only">Actions for {row.headline}</span>
                          </span>
                        }
                        items={[
                          { label: "Edit", icon: <Icon.Edit />, onClick: () => setEditing(row) },
                          ...(row.triggerHref ? [{ label: "View trigger", icon: <Icon.Eye />, href: row.triggerHref }] : []),
                          ...(row.offerHref ? [{ label: "View offer", icon: <Icon.Eye />, href: row.offerHref }] : []),
                          row.active
                            ? { label: "Pause", icon: <Icon.Pause />, onClick: () => run([row.id], "pause"), disabled: busy }
                            : { label: "Activate", icon: <Icon.CheckCircle />, onClick: () => run([row.id], "activate"), disabled: busy },
                          { label: "Delete", icon: <Icon.Trash />, destructive: true, separator: true, onClick: () => setDeleting([row.id]), disabled: busy },
                        ]}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, p)}`} label="Upsell pages" summary={`${total} upsell${total === 1 ? "" : "s"}`} />
          <p className="text-xs text-ink-muted">
            A buyer sees one offer per item: the oldest active upsell of the item they buy. Offers are hidden from buyers who already own the offered item.{" "}
            <Link href="/admin/settings/transactions" className="font-medium text-accent hover:underline">
              See all orders
            </Link>
          </p>
        </>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New upsell" : "Edit upsell"} size="lg">
        {editing && <UpsellForm key={editing === "new" ? "new" : editing.id} upsell={editing === "new" ? null : editing} choices={choices} onDone={() => setEditing(null)} />}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => (busy ? undefined : setDeleting(null))}
        onConfirm={() => {
          if (deleting) run(deleting, "delete");
        }}
        loading={busy}
        destructive
        title={`Delete ${deleting?.length ?? 0} upsell${deleting?.length === 1 ? "" : "s"}?`}
        description="The offer stops showing at checkout and after purchases. Orders that came from it are kept."
        confirmLabel="Delete"
      />
    </div>
  );
}
