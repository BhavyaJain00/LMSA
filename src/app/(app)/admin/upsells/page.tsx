import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { getAdminUpsells, parseAdminUpsellFilter, upsellItemChoices } from "@/lib/commerce/upsell-service";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader, StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { UpsellsManager, type UpsellRowData } from "@/components/commerce/upsells-manager";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Upsells" };

/**
 * Upsells: when a learner buys a course or bundle (the trigger), offer
 * another one at a discount, as a tick box at checkout (order bump, charged
 * in the same payment) and as a one-click offer on the order page.
 */
export default async function UpsellsPage(props: PageProps<"/admin/upsells">) {
  await requireRole(["admin"], "/admin/upsells");
  const sp = await props.searchParams;
  const filter = parseAdminUpsellFilter(sp);
  const [data, db] = await Promise.all([getAdminUpsells(filter), getDb()]);
  const choices = upsellItemChoices(db).map((c) => ({ ref: c.ref, type: c.type, title: c.title, price: c.price, currency: c.currency, published: c.published }));
  const rows: UpsellRowData[] = data.rows.map((r) => ({
    id: r.id,
    triggerRef: `${r.triggerItemType}:${r.triggerItemId}`,
    offerRef: `${r.offerItemType}:${r.offerItemId}`,
    triggerTitle: r.triggerTitle,
    offerTitle: r.offerTitle,
    triggerHref: r.triggerHref,
    offerHref: r.offerHref,
    triggerType: r.triggerItemType,
    offerType: r.offerItemType,
    discountPercent: r.discountPercent,
    headline: r.headline,
    active: r.active,
    offerPrice: r.offerPrice,
    offerDiscounted: r.offerDiscounted,
    currency: r.currency,
    currencyMismatch: r.currencyMismatch,
    unavailable: r.unavailable,
    triggerSales: r.performance.triggerSales,
    accepted: r.performance.accepted,
    bumps: r.performance.bumps,
    postPurchase: r.performance.postPurchase,
    conversionPercent: r.performance.conversionPercent,
    revenueLabel: Object.keys(r.performance.revenue).length ? Object.entries(r.performance.revenue).map(([c, a]) => money(a, c)).join(" + ") : "—",
  }));
  const revenue = data.stats.revenue.length ? data.stats.revenue.map((r) => money(r.amount, r.currency)).join(" + ") : money(0, db.settings.commerce.defaultCurrency);
  const qs = new URLSearchParams();
  if (filter.status !== "all") qs.set("status", filter.status);
  if (filter.search) qs.set("q", filter.search);
  const exportHref = `/admin/upsells/export${qs.size ? `?${qs}` : ""}`;

  return (
    <>
      <PageHeader
        title="Upsells"
        description="Offer a second course or bundle at a discount: as an order bump at checkout and as a one-click offer right after the purchase."
        breadcrumbs={<Breadcrumbs items={[{ label: "Settings", href: "/admin/settings" }, { label: "Upsells" }]} />}
        actions={
          data.stats.total > 0 ? (
            <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" />
              Export CSV
            </a>
          ) : undefined
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Upsells" value={formatNumber(data.stats.total)} hint={`${formatNumber(data.stats.active)} active`} icon={<Icon.TrendingUp className="size-4" />} />
        <StatCard label="Offers accepted" value={formatNumber(data.stats.accepted)} hint="Paid orders from upsells" icon={<Icon.CheckCircle className="size-4" />} />
        <StatCard label="Upsell revenue" value={<span className="text-2xl">{revenue}</span>} hint="Paid, less refunds" icon={<Icon.CreditCard className="size-4" />} />
        <StatCard label="Items to offer" value={formatNumber(choices.length)} hint="Paid courses and bundles" icon={<Icon.Layers className="size-4" />} />
      </div>
      <div className="pb-10">
        <UpsellsManager
          rows={rows}
          total={data.total}
          page={data.page}
          pageCount={data.pageCount}
          filter={{ status: filter.status, q: filter.search ?? "" }}
          choices={choices}
          upsellCount={data.stats.total}
        />
      </div>
    </>
  );
}
