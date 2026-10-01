"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteTaxRulesAction, saveCurrencyPricesAction, saveTaxRuleAction, saveTaxSettingsAction } from "@/lib/actions/taxes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Icon, Spinner } from "@/components/ui/icons";
import { Field, FormError, Input, RadioCard, Select, Switch } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useFormAction } from "@/components/admin/settings/use-form-action";
import { formatPrice } from "@/lib/utils";
import { Pager } from "./pager";

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

/** Tax mode (single rate / by country) and the multi-currency switch. */
export function TaxSettingsForm({ taxMode, multiCurrency, flatRateLabel }: { taxMode: "none" | "by_country"; multiCurrency: boolean; flatRateLabel: string }) {
  const { onSubmit, pending } = useFormAction(saveTaxSettingsAction);
  const [mode, setMode] = useState(taxMode);
  const [multi, setMulti] = useState(multiCurrency);
  const dirty = mode !== taxMode || multi !== multiCurrency;
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink">How tax is charged</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <RadioCard
            name="taxMode"
            value="none"
            checked={mode === "none"}
            onChange={() => setMode("none")}
            icon={<Icon.Percent className="size-4" />}
            title="One rate for everyone"
            description={`${flatRateLabel}. Set it under Payments.`}
          />
          <RadioCard
            name="taxMode"
            value="by_country"
            checked={mode === "by_country"}
            onChange={() => setMode("by_country")}
            icon={<Icon.Globe className="size-4" />}
            title="By the buyer's country"
            description="Uses the rules below for the country of the billing address. Other countries pay the single rate, if any."
          />
        </div>
      </fieldset>
      <div className="rounded-lg border border-border px-4 py-3">
        <Switch
          id="multiCurrency"
          name="multiCurrency"
          checked={multi}
          onChange={(e) => setMulti(e.target.checked)}
          label="Sell in several currencies"
          description="Buyers choose the currency at checkout and pay the fixed price you set for it. Items without a price in that currency use their own."
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!dirty}>
          Save settings
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Tax rules                                                           */
/* ------------------------------------------------------------------ */

export interface TaxRuleRowData {
  id: string;
  country: string;
  countryName: string;
  name: string;
  rate: number;
  inclusive: boolean;
  orders: number;
  collectedLabel: string;
}

function TaxRuleForm({ rule, countries, onDone }: { rule: TaxRuleRowData | null; countries: { code: string; name: string }[]; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(saveTaxRuleAction, { onSuccess: onDone });
  const [rate, setRate] = useState(rule ? String(rule.rate) : "");
  const [inclusive, setInclusive] = useState(rule?.inclusive ?? false);
  const pct = Number(rate.replace(",", "."));
  const example = Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : null;
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      {formError && !Object.keys(errors).length && <FormError message={formError} />}
      <Field label="Country" htmlFor="tax-country" error={errors.country} required>
        <Select
          id="tax-country"
          name="country"
          defaultValue={rule?.country ?? ""}
          placeholder="Choose a country"
          options={countries.map((c) => ({ value: c.code, label: c.name }))}
          invalid={!!errors.country}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Tax name" htmlFor="tax-name" error={errors.name} hint={errors.name ? undefined : "Printed on invoices, e.g. VAT or GST."} required>
          <Input id="tax-name" name="name" defaultValue={rule?.name ?? ""} maxLength={40} invalid={!!errors.name} />
        </Field>
        <Field label="Rate" htmlFor="tax-rate" error={errors.rate} required>
          <Input id="tax-rate" name="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} rightAddon="%" invalid={!!errors.rate} />
        </Field>
      </div>
      <div className="rounded-lg border border-border px-4 py-3">
        <Switch
          id="tax-inclusive"
          name="inclusive"
          checked={inclusive}
          onChange={(e) => setInclusive(e.target.checked)}
          label="Prices include this tax"
          description="Common for VAT: buyers pay the listed price and the tax is carved out of it. Off: the tax is added on top."
        />
      </div>
      {example !== null && (
        <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink-muted" aria-live="polite">
          A {formatPrice(10000, "USD")} item costs{" "}
          <strong className="text-ink">
            {inclusive ? formatPrice(10000, "USD") : formatPrice(Math.round(10000 * (1 + example / 100)), "USD")}
          </strong>{" "}
          of which {formatPrice(inclusive ? 10000 - Math.round(10000 / (1 + example / 100)) : Math.round(100 * example), "USD")} is tax.
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}

/** Tax rules by country: add, edit, delete (one or several). */
export function TaxRulesManager({ rules, countries, byCountry }: { rules: TaxRuleRowData[]; countries: { code: string; name: string }[]; byCountry: boolean }) {
  const toast = useToast();
  const [editing, setEditing] = useState<TaxRuleRowData | "new" | null>(null);
  const [deleting, setDeleting] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, startTransition] = useTransition();
  const selectedIds = rules.filter((r) => selected.has(r.id)).map((r) => r.id);

  const remove = (ids: string[]) =>
    startTransition(async () => {
      const res = await deleteTaxRulesAction(ids);
      if (res.ok) {
        toast.success(res.message ?? "Deleted");
        setSelected(new Set());
      } else toast.error("The tax rules could not be deleted", res.error);
      setDeleting(null);
    });

  const addButton = (
    <Button size="sm" onClick={() => setEditing("new")} leftIcon={<Icon.Plus className="size-4" />}>
      Add tax rule
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-ink-muted">
          {rules.length === 0 ? "No tax rules yet." : `${rules.length} countr${rules.length === 1 ? "y" : "ies"} with their own tax.`}
          {!byCountry && rules.length > 0 && " They apply once tax is charged by the buyer's country."}
        </p>
        {addButton}
      </div>
      {rules.length === 0 ? (
        <EmptyState
          icon={<Icon.Percent />}
          title="Add your first tax rule"
          description="Set the VAT, GST or sales tax of each country you sell to. Buyers from other countries pay the single rate from Payments, if any."
          action={addButton}
        />
      ) : (
        <>
          {selectedIds.length > 0 && (
            <div role="region" aria-label="Bulk actions" className="flex flex-col gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-ink">
                {selectedIds.length} selected
                <button type="button" onClick={() => setSelected(new Set())} className="ml-3 text-sm font-normal text-accent hover:underline">
                  Clear
                </button>
              </p>
              <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => setDeleting(selectedIds)}>
                Delete
              </Button>
            </div>
          )}
          <Table>
            <THead>
              <TR>
                <TH className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all tax rules"
                    className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                    checked={selectedIds.length === rules.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rules.map((r) => r.id)) : new Set())}
                  />
                </TH>
                <TH>Country</TH>
                <TH>Tax</TH>
                <TH className="hidden text-right sm:table-cell">Collected</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rules.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Select the rule for ${r.countryName}`}
                      className="size-4 cursor-pointer rounded border-border-strong accent-accent"
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </TD>
                  <TD>
                    <button type="button" onClick={() => setEditing(r)} className="text-left font-medium text-ink hover:text-accent hover:underline">
                      {r.countryName}
                    </button>
                    <p className="font-mono text-xs text-ink-muted">{r.country}</p>
                  </TD>
                  <TD>
                    <span className="font-medium tabular-nums">
                      {r.name} {r.rate}%
                    </span>
                    <div className="mt-0.5">
                      <Badge tone={r.inclusive ? "info" : "neutral"}>{r.inclusive ? "Included in price" : "Added at checkout"}</Badge>
                    </div>
                  </TD>
                  <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                    <span className="font-medium">{r.collectedLabel}</span>
                    <p className="text-xs text-ink-muted">
                      {r.orders} order{r.orders === 1 ? "" : "s"}
                    </p>
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit the rule for ${r.countryName}`}>
                        <Icon.Edit className="size-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-danger" disabled={busy} onClick={() => setDeleting([r.id])} aria-label={`Delete the rule for ${r.countryName}`}>
                        <Icon.Trash className="size-4" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "Add tax rule" : "Edit tax rule"}>
        {editing && <TaxRuleForm key={editing === "new" ? "new" : editing.id} rule={editing === "new" ? null : editing} countries={countries} onDone={() => setEditing(null)} />}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => (busy ? undefined : setDeleting(null))}
        onConfirm={() => {
          if (deleting) remove(deleting);
        }}
        loading={busy}
        destructive
        title={`Delete ${deleting?.length === 1 ? "this tax rule" : `${deleting?.length ?? 0} tax rules`}?`}
        description="New orders from these countries pay the single rate from Payments, if any. Orders already placed keep the tax they were charged."
        confirmLabel="Delete"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fixed prices in other currencies                                    */
/* ------------------------------------------------------------------ */

export interface PricedItemRowData {
  type: "course" | "bundle" | "plan";
  id: string;
  title: string;
  href: string;
  price: number;
  currency: string;
  priceLabel: string;
  prices: Record<string, number>;
}

export interface PricedItemFilterValues {
  type: string;
  q: string;
}

const TYPE_LABEL = { course: "Course", bundle: "Bundle", plan: "Lifetime plan" } as const;

/** `keep` carries the page's other query parameters (the tax report filters). */
function filterQuery(values: PricedItemFilterValues, keep: string, page?: number): string {
  const qs = new URLSearchParams(keep);
  if (values.type && values.type !== "all") qs.set("ptype", values.type);
  if (values.q.trim()) qs.set("pq", values.q.trim());
  if (page && page > 1) qs.set("ppage", String(page));
  return qs.toString();
}

function PricedItemFilters({ values, keep }: { values: PricedItemFilterValues; keep: string }) {
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
  const apply = (next: Partial<PricedItemFilterValues>) => {
    const qs = filterQuery({ ...values, q: search, ...next }, keep);
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]" aria-busy={pending}>
      <Input
        type="search"
        aria-label="Search items"
        placeholder="Search courses, bundles and plans"
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
        aria-label="Filter by type"
        value={values.type}
        onChange={(e) => apply({ type: e.target.value })}
        options={[
          { value: "all", label: "All items" },
          { value: "course", label: "Courses" },
          { value: "bundle", label: "Bundles" },
          { value: "plan", label: "Lifetime plans" },
        ]}
      />
    </div>
  );
}

function PricesForm({ item, currencies, onDone }: { item: PricedItemRowData; currencies: string[]; onDone: () => void }) {
  const { onSubmit, pending, errors, formError } = useFormAction(saveCurrencyPricesAction, { onSuccess: onDone });
  const others = currencies.filter((c) => c !== item.currency);
  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <input type="hidden" name="itemType" value={item.type} />
      <input type="hidden" name="itemId" value={item.id} />
      {formError && !Object.keys(errors).length && <FormError message={formError} />}
      <p className="text-sm text-ink-muted">
        Default price: <strong className="text-ink">{item.priceLabel}</strong>. Leave a currency empty to charge the default price to buyers who pick it.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {others.map((c) => (
          <Field key={c} label={c} htmlFor={`price-${c}`} error={errors[`price_${c}`]}>
            <Input
              id={`price-${c}`}
              name={`price_${c}`}
              inputMode="decimal"
              placeholder="No fixed price"
              defaultValue={item.prices[c] ? (item.prices[c] / 100).toFixed(2) : ""}
              rightAddon={c}
              invalid={!!errors[`price_${c}`]}
            />
          </Field>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          Save prices
        </Button>
      </div>
    </form>
  );
}

/** Fixed prices of courses, bundles and lifetime plans in each sale currency. */
export function CurrencyPricesManager({
  rows,
  total,
  page,
  pageCount,
  filter,
  currencies,
  enabled,
  keep,
}: {
  rows: PricedItemRowData[];
  total: number;
  page: number;
  pageCount: number;
  filter: PricedItemFilterValues;
  currencies: string[];
  enabled: boolean;
  /** Other query parameters of the page to keep when filtering or paging. */
  keep: string;
}) {
  const [editing, setEditing] = useState<PricedItemRowData | null>(null);
  return (
    <div className="space-y-4">
      {!enabled && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          <Icon.Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Turn on “Sell in several currencies” above for buyers to see these prices. You can prepare them now.
        </p>
      )}
      <PricedItemFilters values={filter} keep={keep} />
      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="text-sm font-medium text-ink">{filter.q || filter.type !== "all" ? "No items match these filters" : "Nothing is for sale yet"}</p>
          <p className="mt-1 text-sm text-ink-muted">Paid courses, bundles and lifetime plans appear here.</p>
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Default price</TH>
              <TH className="hidden md:table-cell">Other currencies</TH>
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r) => {
              const fixed = Object.entries(r.prices);
              return (
                <TR key={`${r.type}:${r.id}`}>
                  <TD className="max-w-72">
                    <a href={r.href} className="block truncate font-medium text-ink hover:text-accent hover:underline">
                      {r.title}
                    </a>
                    <p className="text-xs text-ink-muted">
                      {TYPE_LABEL[r.type]}
                      <span className="md:hidden"> · {fixed.length ? `${fixed.length} other currenc${fixed.length === 1 ? "y" : "ies"}` : "Default price only"}</span>
                    </p>
                  </TD>
                  <TD className="whitespace-nowrap text-right tabular-nums">{r.priceLabel}</TD>
                  <TD className="hidden md:table-cell">
                    {fixed.length ? (
                      <div className="flex flex-wrap gap-1">
                        {fixed.map(([c, amount]) => (
                          <Badge key={c} tone="neutral">
                            {formatPrice(amount, c)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-sm text-ink-faint">Default price only</span>
                    )}
                  </TD>
                  <TD className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setEditing(r)} aria-label={`Set prices for ${r.title}`}>
                      Set prices
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => `?${filterQuery(filter, keep, p)}`} label="Item pages" summary={`${total} item${total === 1 ? "" : "s"}`} />
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `Prices for ${editing.title}` : "Prices"} size="lg">
        {editing && <PricesForm key={`${editing.type}:${editing.id}`} item={editing} currencies={currencies} onDone={() => setEditing(null)} />}
      </Dialog>
    </div>
  );
}
