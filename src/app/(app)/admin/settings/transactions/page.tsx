import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { countRemindableOrders, gatewayLabel, getReminderActivity, runAutomaticPaymentReminders, getRecordableItems, getTransactions, parseTransactionFilter, summarizeTransactions } from "@/lib/data/commerce";
import { currencies } from "@/lib/config";
import { isConfigured, isRealGateway, paymentDashboardUrl, refundsViaGateway } from "@/lib/payments/gateway";
import { backfillInvoiceNumbers } from "@/lib/payments/invoice";
import { buttonClasses } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/skeleton";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { TransactionFilters } from "@/components/commerce/transaction-filters";
import { TransactionsTable, type TransactionView } from "@/components/commerce/transactions-table";
import { NewTransactionButton, SendRemindersButton } from "@/components/commerce/transaction-tools";
import { getFormatter } from "@/i18n/server";
import type { Metadata } from "next";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("admin");
  return { title: t("pages.settings.transactions.metaTitle") };
}

const PAGE_SIZE = 25;

export default async function TransactionsSettingsPage(props: PageProps<"/admin/settings/transactions">) {
  const t = await getT("admin");
  await requireRole(["admin"], "/admin/settings/transactions");
  const sp = await props.searchParams;
  const filter = parseTransactionFilter(sp);
  const limitRaw = Number(typeof sp.limit === "string" ? sp.limit : PAGE_SIZE);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : PAGE_SIZE;

  // Daily payment reminders run here (no scheduler): idempotent, once per unpaid order per day.
  await runAutomaticPaymentReminders();
  // Orders paid before invoices existed get their sequential invoice numbers.
  await backfillInvoiceNumbers();
  const [rows, db, items, remindable, reminders] = await Promise.all([
    getTransactions(filter),
    getDb(),
    getRecordableItems(),
    countRemindableOrders(),
    getReminderActivity(),
  ]);
  const f = await getFormatter();
  const formatNumber = (n: number) => f.number(n);
  const money = (cents: number, currency: string) => (cents !== 0 ? f.price(cents, currency) : f.number(0, { style: "currency", currency }));
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
    buyerVatId: r.buyerVatId,
    reverseCharge: r.reverseCharge,
    vatCheck: r.vatCheck,
    source: r.source,
    gateway: r.gateway,
    gatewayLabel: gatewayLabel(r.gateway),
    gatewayPaymentId: r.gatewayPaymentId,
    buyerReference: r.buyerReference,
    gatewayOrderId: r.gatewayOrderId,
    status: r.status,
    createdAt: r.createdAt,
    paidAt: r.paidAt,
    lastReminderAt: r.lastReminderAt,
    invoiceNumber: r.invoiceNumber,
    refundId: r.refundId,
    refundedAmount: r.refundedAmount ?? (r.status === "refunded" ? r.amount : undefined),
    refundedAt: r.refundedAt,
    failureReason: r.failureReason,
    dashboardUrl: paymentDashboardUrl(r),
    refundViaGateway: refundsViaGateway(r),
    gatewayConfigured: isConfigured(r.gateway),
    canSync: r.status === "pending" && isRealGateway(r.gateway) && !!r.gatewayOrderId && isConfigured(r.gateway),
  }));

  const members = db.users
    .filter((u) => u.enabled)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }));
  const coupons = [...db.coupons].sort((a, b) => a.code.localeCompare(b.code)).map((c) => ({ id: c.id, code: c.code, enabled: c.enabled }));
  const currencyOptions = Array.from(new Set<string>([...currencies, db.settings.commerce.defaultCurrency, ...items.map((i) => i.currency)]));

  const revenueLabel = stats.revenue.length ? stats.revenue.map((r) => money(r.amount, r.currency)).join(" + ") : money(0, db.settings.commerce.defaultCurrency);
  const refundedLabel = stats.refunded.map((r) => money(r.amount, r.currency)).join(" + ");

  return (
    <>
      <SettingsPanelHeader
        title={t("pages.settings.transactions.title")}
        description={t("pages.settings.transactions.description")}
        actions={
          <>
            {db.settings.commerce.sendPaymentReminders && <SendRemindersButton count={remindable} />}
            {totalPayments > 0 && (
              <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
                <Icon.Download className="size-4" />
                {t("pages.shared.exportCsv")}
              </a>
            )}
            <NewTransactionButton members={members} items={items} coupons={coupons} currencies={currencyOptions} defaultCurrency={db.settings.commerce.defaultCurrency} />
          </>
        }
      />
      {db.settings.commerce.sendPaymentReminders && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-ink-muted">
          <Icon.Bell className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t("pages.settings.transactions.reminders.on")}{" "}
            {reminders.lastSentAt
              ? t("pages.settings.transactions.reminders.today", { count: reminders.remindedToday, when: f.relative(reminders.lastSentAt) })
              : t("pages.settings.transactions.reminders.none")}{" "}
            <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
              {t("pages.settings.transactions.reminders.change")}
            </Link>
          </span>
        </p>
      )}
      {totalPayments === 0 ? (
        <EmptyState
          icon={<Icon.Receipt />}
          title={t("pages.settings.transactions.empty.title")}
          description={t("pages.settings.transactions.empty.description")}
        />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={t("pages.settings.transactions.stats.net")} value={<span className="text-xl sm:text-2xl">{revenueLabel}</span>} hint={refundedLabel ? t("pages.settings.transactions.stats.afterRefunds", { amount: refundedLabel }) : t("pages.settings.transactions.stats.inView")} icon={<Icon.TrendingUp className="size-5" />} />
            <StatCard label={t("pages.settings.transactions.stats.paid")} value={formatNumber(stats.paidCount)} icon={<Icon.CheckCircle className="size-5" />} />
            <StatCard label={t("pages.settings.transactions.stats.awaiting")} value={formatNumber(stats.pendingCount)} icon={<Icon.Clock className="size-5" />} />
            <StatCard label={t("pages.settings.transactions.stats.refunded")} value={formatNumber(stats.refundedCount)} hint={stats.failedCount ? t("pages.settings.transactions.stats.failed", { count: stats.failedCount }) : undefined} icon={<Icon.Refresh className="size-5" />} />
          </div>
          <TransactionFilters values={{ status: filter.status, type: filter.type, from: filter.from ?? "", to: filter.to ?? "", search: filter.search ?? "" }} />
          <TransactionsTable rows={views} total={rows.length} loadMoreHref={loadMoreHref} />
        </div>
      )}
    </>
  );
}
