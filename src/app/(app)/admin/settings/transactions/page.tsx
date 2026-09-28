import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { gatewayLabel, getTransactions, parseTransactionFilter, summarizeTransactions } from "@/lib/data/commerce";
import { buttonClasses } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { TransactionFilters } from "@/components/commerce/transaction-filters";
import { TransactionsTable, type TransactionView } from "@/components/commerce/transactions-table";
import { formatNumber, formatPrice } from "@/lib/utils";

export const metadata = { title: "Transactions" };

const PAGE_SIZE = 25;

export default async function TransactionsSettingsPage(props: PageProps<"/admin/settings/transactions">) {
  await requireRole(["admin"], "/admin/settings/transactions");
  const sp = await props.searchParams;
  const filter = parseTransactionFilter(sp);
  const limitRaw = Number(typeof sp.limit === "string" ? sp.limit : PAGE_SIZE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : PAGE_SIZE;

  const [rows, db] = await Promise.all([getTransactions(filter), getDb()]);
  const stats = summarizeTransactions(rows);
  const totalPayments = db.payments.length;

  const query = new URLSearchParams();
  if (filter.status !== "all") query.set("status", filter.status);
  if (filter.type !== "all") query.set("type", filter.type);
  if (filter.from) query.set("from", filter.from);
  if (filter.to) query.set("to", filter.to);
  if (filter.search) query.set("search", filter.search);
  const qs = query.toString();
  const exportHref = `/admin/settings/transactions/export${qs ? `?${qs}` : ""}`;
  const moreQuery = new URLSearchParams(query);
  moreQuery.set("limit", String(limit + PAGE_SIZE));
  const loadMoreHref = rows.length > limit ? `/admin/settings/transactions?${moreQuery}` : null;

  const views: TransactionView[] = rows.slice(0, limit).map((r) => ({
    id: r.id,
    orderId: r.orderId,
    userId: r.userId,
    userName: r.userName,
    userEmail: r.userEmail,
    username: r.username,
    itemType: r.itemType,
    itemId: r.itemId,
    itemTitle: r.itemTitle,
    itemHref: r.itemHref,
    originalAmount: r.originalAmount,
    discountAmount: r.discountAmount,
    taxAmount: r.taxAmount,
    amount: r.amount,
    currency: r.currency,
    couponCode: r.couponCode,
    billingName: r.billingName,
    address: r.address,
    gstin: r.gstin,
    pan: r.pan,
    source: r.source,
    gateway: r.gateway,
    gatewayLabel: gatewayLabel(r.gateway),
    gatewayPaymentId: r.gatewayPaymentId,
    status: r.status,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
  }));

  const revenueLabel = stats.revenue.length ? stats.revenue.map((r) => formatPrice(r.amount, r.currency)).join(" + ") : formatPrice(0, db.settings.commerce.defaultCurrency, "0");

  return (
    <>
      <SettingsPanelHeader
        title="Transactions"
        description="Every order placed at checkout. Confirm manual payments, refund orders and export records."
        actions={
          totalPayments > 0 ? (
            <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
              <Icon.Download className="size-4" />
              Export CSV
            </a>
          ) : undefined
        }
      />
      {totalPayments === 0 ? (
        <EmptyState
          icon={<Icon.Receipt />}
          title="No Transactions Found"
          description="Orders appear here as soon as learners check out a paid course, batch or certificate."
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Revenue" value={<span className="text-xl sm:text-2xl">{revenueLabel}</span>} hint="Paid orders in view" icon={<Icon.TrendingUp className="size-5" />} />
            <StatCard label="Paid" value={formatNumber(stats.paidCount)} icon={<Icon.CheckCircle className="size-5" />} />
            <StatCard label="Awaiting payment" value={formatNumber(stats.pendingCount)} icon={<Icon.Clock className="size-5" />} />
            <StatCard label="Refunded" value={formatNumber(stats.refundedCount)} hint={stats.failedCount ? `${stats.failedCount} cancelled` : undefined} icon={<Icon.Refresh className="size-5" />} />
          </div>
          <TransactionFilters values={{ status: filter.status, type: filter.type, from: filter.from ?? "", to: filter.to ?? "", search: filter.search ?? "" }} />
          <TransactionsTable rows={views} total={rows.length} loadMoreHref={loadMoreHref} />
        </div>
      )}
    </>
  );
}
