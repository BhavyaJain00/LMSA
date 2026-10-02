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
import { CurrencyPricesManager, TaxRulesManager, TaxSettingsForm, type PricedItemRowData, type TaxRuleRowData } from "@/components/commerce/taxes-manager";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.taxes.metaTitle") };
}

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
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/taxes");
  const sp = await props.searchParams;
  const { settings, rules, report, reportFilter, items, itemFilter, currencies } = await getTaxAdmin(sp);
  const f = await getFormatter();
  const money = (cents: number, currency: string) => (cents !== 0 ? f.price(cents, currency) : f.number(0, { style: "currency", currency }));
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
        title={t("pages.settings.taxes.title")}
        description={t("pages.settings.taxes.description")}
      />

      <div className="space-y-8 pb-10">
        <SettingsSection title={t("pages.settings.taxes.settings")}>
          <TaxSettingsForm
            taxMode={settings.growth.taxMode}
            multiCurrency={settings.growth.multiCurrency}
            flatRateLabel={c.applyTax && c.taxPercentage > 0 ? t("pages.settings.taxes.currentRate", { label: c.taxLabel || t("pages.settings.taxes.tax"), rate: f.percent(c.taxPercentage) }) : t("pages.settings.taxes.noTax")}
          />
          <p className="mt-3 text-xs text-ink-muted">
            {t("pages.settings.taxes.computed")}{" "}
            <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
              {t("pages.settings.taxes.singleRate")}
            </Link>
          </p>
        </SettingsSection>

        <section aria-labelledby="tax-rules-heading">
          <h2 id="tax-rules-heading" className="mb-1 text-base font-semibold text-ink">
            {t("pages.settings.taxes.rules.title")}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            {byCountry ? t("pages.settings.taxes.rules.applied") : t("pages.settings.taxes.rules.saved")}
          </p>
          <TaxRulesManager rules={ruleRows} countries={countries} byCountry={byCountry} />
        </section>

        <section aria-labelledby="currency-prices-heading">
          <h2 id="currency-prices-heading" className="mb-1 text-base font-semibold text-ink">
            {t("pages.settings.taxes.prices.title")}
          </h2>
          <p className="mb-3 text-sm text-ink-muted">
            {t("pages.settings.taxes.prices.description")}
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
                {t("pages.settings.taxes.report.title")}
              </h2>
              <p className="text-sm text-ink-muted">{t("pages.settings.taxes.report.description")}</p>
            </div>
            {report.count > 0 && (
              <a href={exportHref} download className={buttonClasses({ variant: "outline", size: "sm" })}>
                <Icon.Download className="size-4" />
                {t("pages.shared.exportCsv")}
              </a>
            )}
          </div>
          <form method="get" className="mb-4 grid gap-2 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto] sm:items-end">
            {itemFilter.type !== "all" && <input type="hidden" name="ptype" value={itemFilter.type} />}
            {itemFilter.search && <input type="hidden" name="pq" value={itemFilter.search} />}
            <label className="text-xs font-medium text-ink-muted">
              {t("pages.settings.taxes.report.from")}
              <Input type="date" name="from" defaultValue={reportFilter.from ?? ""} className="mt-1" />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              {t("pages.settings.taxes.report.to")}
              <Input type="date" name="to" defaultValue={reportFilter.to ?? ""} className="mt-1" />
            </label>
            <label className="text-xs font-medium text-ink-muted">
              {t("pages.settings.taxes.report.country")}
              <select
                name="country"
                defaultValue={reportFilter.country ?? ""}
                className="mt-1 h-9.5 w-full rounded-lg border border-border-strong bg-surface-1 px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              >
                <option value="">{t("pages.settings.taxes.report.allCountries")}</option>
                {countries.map((x) => (
                  <option key={x.code} value={x.code}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClasses({ size: "sm" })}>
              {t("pages.shared.apply")}
            </button>
            {filtered && (
              <Link href="/admin/settings/taxes" className={buttonClasses({ variant: "ghost", size: "sm" })}>
                {t("pages.shared.clear")}
              </Link>
            )}
          </form>

          {report.totals.length > 0 && (
            <dl className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {report.totals.map((total) => (
                <div key={total.currency} className="rounded-card border border-border bg-surface-1 px-4 py-3 shadow-card">
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                    {t("pages.settings.taxes.report.collected", { currency: total.currency, count: total.orders })}
                  </dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{money(total.tax, total.currency)}</dd>
                  <dd className="text-xs text-ink-muted tabular-nums">
                    {t("pages.settings.taxes.report.onNet", { net: money(total.net, total.currency), charged: money(total.total, total.currency) })}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          {report.count === 0 ? (
            <div className="rounded-card border border-dashed border-border-strong px-6 py-12 text-center">
              <p className="text-sm font-medium text-ink">{filtered ? t("pages.settings.taxes.report.noMatch") : t("pages.settings.taxes.report.none")}</p>
              <p className="mt-1 text-sm text-ink-muted">{t("pages.settings.taxes.report.noneHint")}</p>
            </div>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>{t("pages.settings.taxes.report.order")}</TH>
                    <TH className="hidden sm:table-cell">{t("pages.settings.taxes.report.country")}</TH>
                    <TH className="hidden md:table-cell">{t("pages.settings.taxes.tax")}</TH>
                    <TH className="text-end">{t("pages.settings.taxes.report.amount")}</TH>
                    <TH className="hidden text-end sm:table-cell">{t("pages.settings.taxes.report.total")}</TH>
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
                          {f.date(l.paidAt)} · {l.buyer}
                          {l.refunded && <span className="ms-1 text-danger">· {t("pages.settings.taxes.report.refunded")}</span>}
                        </p>
                      </TD>
                      <TD className="hidden sm:table-cell">{l.country ? countryName(l.country) : "—"}</TD>
                      <TD className="hidden md:table-cell">{taxLineLabel({ name: l.taxName, rate: l.rate, inclusive: l.inclusive })}</TD>
                      <TD className="whitespace-nowrap text-end tabular-nums">{money(l.tax, l.currency)}</TD>
                      <TD className="hidden whitespace-nowrap text-end tabular-nums sm:table-cell">{money(l.total, l.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {report.count > report.lines.length && (
                <p className="mt-2 text-xs text-ink-muted">
                  {t("pages.settings.taxes.report.showing", { shown: report.lines.length, total: report.count })}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </>
  );
}
