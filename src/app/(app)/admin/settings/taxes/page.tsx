import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getTaxAdmin } from "@/lib/commerce/tax-views";
import { countryCode, countryName, taxLineLabel } from "@/lib/commerce/tax";
import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { SettingsPanelHeader, SettingsSection } from "@/components/admin/settings/settings-ui";
import { COUNTRIES } from "@/components/commerce/countries";
import { money } from "@/components/commerce/order-summary";
import { CurrencyPricesManager, TaxRulesManager, TaxSettingsForm, type PricedItemRowData, type TaxRuleRowData } from "@/components/commerce/taxes-manager";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Taxes & currencies" };

/** Countries of the billing form with their ISO codes, by name. */
function countryChoices(): { code: string; name: string }[] {
  const seen = new Set<string>();
  const out: { code: string; name: string }[] = [];
  for (const name of COUNTRIES) {
    const code = countryCode(name);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, name });
  }
  return out;
}

export default async function TaxesSettingsPage(props: PageProps<"/admin/settings/taxes">) {
  await requireRole(["admin"], "/admin/settings/taxes");
  const sp = await props.searchParams;
  const { settings, rules, report, reportFilter, items, itemFilter, currencies } = await getTaxAdmin(sp);
  const c = settings.commerce;
  const byCountry = settings.growth.taxMode === "by_country";
  const countries = countryChoices();

  const ruleRows: TaxRuleRowData[] = rules.map((r) => ({
    id: r.id,
    country: r.country,
    countryName: r.countryName,
    name: r.name,
    rate: r.rate,
    inclusive: r.inclusive,
    orders: r.orders,
    collectedLabel: r.collected.length ? r.collected.map((x) => money(x.amount, x.currency)).join(" + ") : "—",
  }));
  const itemRows: PricedItemRowData[] = items.rows.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.title,
    href: r.href,
    price: r.price,
    currency: r.currency,
    priceLabel: r.priceLabel,
    prices: r.prices,
  }));

  const reportQuery = new URLSearchParams();
  if (reportFilter.from) reportQuery.set("from", reportFilter.from);
  if (reportFilter.to) reportQuery.set("to", reportFilter.to);
  if (reportFilter.country) reportQuery.set("country", reportFilter.country);
  const exportHref = `/admin/settings/taxes/export${reportQuery.size ? `?${reportQuery}` : ""}`;
  const filtered = reportQuery.size > 0;

  return (
    <>
      <SettingsPanelHeader
        title="Taxes & currencies"
        description="Charge the right tax for each buyer's country, and sell at fixed prices in other currencies."
      />

      <div className="space-y-8 pb-10">
        <SettingsSection title="Settings">
          <TaxSettingsForm
            taxMode={settings.growth.taxMode}
            multiCurrency={settings.growth.multiCurrency}
            flatRateLabel={c.applyTax && c.taxPercentage > 0 ? `Currently ${c.taxLabel || "Tax"} ${c.taxPercentage}%, added at checkout` : "Currently no tax"}
          />
          <p className="mt-3 text-xs text-ink-muted">
            Tax is computed on the server for the country of the billing address and rounded once per order to the smallest unit of its currency.{" "}
            <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
              Single rate and default currency are in Payments
            </Link>
          </p>
        </SettingsSection>

        <section aria-labelledby="tax-rules-heading">
          <h2 id="tax-rules-heading" className="mb-1 text-base font-semibold text-ink">
            Tax rules
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            {byCountry ? "Applied to every new order from these countries." : "Saved for when tax is charged by the buyer's country; not applied right now."}
          </p>
          <TaxRulesManager rules={ruleRows} countries={countries} byCountry={byCountry} />
        </section>

        <section aria-labelledby="currency-prices-heading">
          <h2 id="currency-prices-heading" className="mb-1 text-base font-semibold text-ink">
            Prices in other currencies
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            Fixed prices for buyers who pay in another currency. Memberships that renew are always billed in their own currency.
          </p>
          <CurrencyPricesManager
            rows={itemRows}
            total={items.total}
            page={items.page}
            pageCount={items.pageCount}
            filter={{ type: itemFilter.type, q: itemFilter.search ?? "" }}
            currencies={currencies}
            enabled={settings.growth.multiCurrency}
            keep={reportQuery.toString()}
          />
        </section>

        <section aria-labelledby="tax-report-heading">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="tax-report-heading" className="text-base font-semibold text-ink">
                Tax report
              </h2>
              <p className="text-sm text-ink-muted">Tax charged on paid orders. Refunded orders are listed with a mark.</p>
            </div>
            {report.count > 0 && (
              <a href={exportHref} download className={buttonClasses({ variant: "outline", size: "sm" })}>
                <Icon.Download className="size-4" />
                Export CSV
              </a>
            )}
          </div>
          <form method="get" className="mb-4 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-end">
            {itemFilter.type !== "all" && <input type="hidden" name="ptype" value={itemFilter.type} />}
            {itemFilter.search && <input type="hidden" name="pq" value={itemFilter.search} />}
            <label className="text-xs font-medium text-ink-muted">
              From
              <Input type="date" name="from" defaultValue={reportFilter.from ?? ""} className="mt-1" />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              To
              <Input type="date" name="to" defaultValue={reportFilter.to ?? ""} className="mt-1" />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              Country
              <select
                name="country"
                defaultValue={reportFilter.country ?? ""}
                className="mt-1 h-9.5 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <option value="">All countries</option>
                {countries.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClasses({ size: "sm" })}>
              Apply
            </button>
            {filtered && (
              <Link href="/admin/settings/taxes" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                Clear
              </Link>
            )}
          </form>

          {report.totals.length > 0 && (
            <dl className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.totals.map((t) => (
                <div key={t.currency} className="rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    Tax collected · {t.currency} · {t.orders} order{t.orders === 1 ? "" : "s"}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{money(t.tax, t.currency)}</dd>
                  <dd className="text-xs text-ink-muted tabular-nums">
                    on {money(t.net, t.currency)} net · {money(t.total, t.currency)} charged
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {report.count === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
              <p className="text-sm font-medium text-ink">{filtered ? "No taxed orders match these filters" : "No tax charged yet"}</p>
              <p className="mt-1 text-sm text-ink-muted">Paid orders that include tax will appear here.</p>
            </div>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Order</TH>
                    <TH className="hidden sm:table-cell">Country</TH>
                    <TH className="hidden md:table-cell">Tax</TH>
                    <TH className="text-right">Tax amount</TH>
                    <TH className="hidden text-right sm:table-cell">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {report.lines.map((l) => (
                    <TR key={l.orderId}>
                      <TD>
                        <Link href={`/billing/success/${encodeURIComponent(l.orderId)}`} className="font-medium text-ink hover:text-accent hover:underline">
                          {l.invoiceNumber || l.orderId}
                        </Link>
                        <p className="text-xs text-ink-muted">
                          {formatDate(l.paidAt)} · {l.buyer}
                          {l.refunded && <span className="ml-1 text-danger">· refunded</span>}
                        </p>
                      </TD>
                      <TD className="hidden sm:table-cell">{l.country ? countryName(l.country) : "—"}</TD>
                      <TD className="hidden md:table-cell">{taxLineLabel({ name: l.taxName, rate: l.rate, inclusive: l.inclusive })}</TD>
                      <TD className="whitespace-nowrap text-right tabular-nums">{money(l.tax, l.currency)}</TD>
                      <TD className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">{money(l.total, l.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {report.count > report.lines.length && (
                <p className="mt-2 text-xs text-ink-muted">
                  Showing the latest {report.lines.length} of {report.count} orders. Export the CSV for all of them.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
