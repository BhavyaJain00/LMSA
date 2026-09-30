import Link from "next/link";
import { requireRole } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { currencies } from "@/lib/config";
import { gatewayLabel } from "@/lib/data/commerce";
import { getGatewayStatuses, isRealGateway } from "@/lib/payments/gateway";
import { runMembershipMaintenance } from "@/lib/commerce/membership-service";
import { getAdminMembers, getAdminPlans, parseMemberFilter } from "@/lib/commerce/membership-views";
import { planSavingsPercent } from "@/lib/commerce/plans";
import { isOngoing } from "@/lib/commerce/subscriptions";
import { buttonClasses } from "@/components/ui/button";
import { StatCard } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Tabs } from "@/components/ui/tabs";
import { SettingsPanelHeader } from "@/components/admin/settings/settings-ui";
import { money } from "@/components/commerce/order-summary";
import { MembershipSalesSwitch, PlansManager, type PlanRowData } from "@/components/commerce/plans-manager";
import { GrantMembershipButton, MembershipMembers, type MemberRowData } from "@/components/commerce/membership-members";
import { BundleSalesSwitch, BundlesManager, type BundleRowData } from "@/components/commerce/bundles-manager";
import { getAdminBundles, parseAdminBundleFilter } from "@/lib/commerce/bundle-views";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Plans & bundles" };

const GATEWAY_NAMES: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

export default async function PlansSettingsPage(props: PageProps<"/admin/settings/plans">) {
  await requireRole(["admin"], "/admin/settings/plans");
  const sp = await props.searchParams;
  const tab = sp.tab === "members" ? "members" : sp.tab === "bundles" ? "bundles" : "plans";

  // No scheduler needed: memberships paid by hand move to "payment due" / "ended", renewal orders are
  // opened and missed gateway webhooks are caught up whenever an administrator opens this page.
  await runMembershipMaintenance().catch((error) => {
    console.error("[memberships] maintenance failed:", error instanceof Error ? error.message : String(error));
  });

  const [{ plans, stats, courses }, db] = await Promise.all([getAdminPlans(), getDb()]);
  const settings = db.settings;
  const gateway = settings.commerce.paymentGateway;
  const gatewayStatus = isRealGateway(gateway) ? getGatewayStatuses().find((g) => g.gateway === gateway) : undefined;
  const ongoing = db.subscriptions.filter((s) => isOngoing(s)).length;
  const mrr = Object.entries(stats.mrr);
  const mrrLabel = mrr.length ? mrr.map(([currency, amount]) => money(amount, currency)).join(" + ") : money(0, settings.commerce.defaultCurrency);

  const planRows: PlanRowData[] = plans.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    interval: p.interval,
    price: p.price,
    currency: p.currency,
    trialDays: p.trialDays,
    accessType: p.access.type,
    courseIds: p.access.type === "courses" ? p.access.courseIds : [],
    courseTitles: p.courseTitles,
    active: p.active,
    features: p.features,
    stripePriceId: p.gatewayPriceIds?.stripe ?? "",
    razorpayPlanId: p.gatewayPriceIds?.razorpay ?? "",
    activeMembers: p.activeMembers,
    trialing: p.trialing,
    totalMembers: p.totalMembers,
    savingsPercent: planSavingsPercent(
      p,
      plans.filter((other) => other.active),
    ),
  }));
  const currencyOptions = Array.from(new Set<string>([...currencies, settings.commerce.defaultCurrency, ...plans.map((p) => p.currency)]));

  const filter = parseMemberFilter(sp);
  const members = tab === "members" ? await getAdminMembers(filter) : null;
  const exportQuery = new URLSearchParams();
  if (filter.status !== "ongoing") exportQuery.set("status", filter.status);
  if (filter.planId) exportQuery.set("plan", filter.planId);
  if (filter.gateway) exportQuery.set("gateway", filter.gateway);
  if (filter.search) exportQuery.set("q", filter.search);
  const exportHref = `/admin/settings/plans/export${exportQuery.size ? `?${exportQuery}` : ""}`;

  const memberRows: MemberRowData[] = (members?.rows ?? []).map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.userName,
    userEmail: r.userEmail,
    planName: r.planName,
    status: r.status,
    statusLabel: r.statusLabel,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd,
    gatewayLabel: r.gatewayLabel,
    gatewayManaged: r.gatewayManaged,
    gatewayName: r.gatewayManaged ? (GATEWAY_NAMES[r.gateway] ?? r.gatewayLabel) : null,
    dashboardUrl: r.dashboardUrl,
    currentPeriodEnd: r.currentPeriodEnd,
    createdAt: r.createdAt,
    paidOrders: r.paidOrders,
    lifetimeValue: r.lifetimeValue,
    currency: r.currency,
  }));
  const bundleFilter = parseAdminBundleFilter(sp);
  const bundles = tab === "bundles" ? await getAdminBundles(bundleFilter) : null;
  const bundleRows: BundleRowData[] = (bundles?.rows ?? []).map((b) => ({
    id: b.id,
    slug: b.slug,
    title: b.title,
    description: b.description,
    courseIds: b.liveCourseIds,
    courseTitles: b.courseTitles,
    price: b.price,
    currency: b.currency,
    imageUrl: b.imageUrl ?? "",
    published: b.published,
    onSale: b.onSale,
    unpublishedCourses: b.unpublishedCourses,
    missingCourses: b.missingCourses,
    totalValue: b.totalValue,
    savingsPercent: b.savingsPercent,
    comparable: b.comparable,
    paidOrders: b.paidOrders,
    openOrders: b.openOrders,
    revenue: b.revenue,
    deletable: b.deletable,
    updatedAt: b.updatedAt,
  }));

  const pickerMembers =
    tab === "members"
      ? db.users
          .filter((u) => u.enabled)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }))
      : [];

  return (
    <>
      <SettingsPanelHeader
        title="Membership plans"
        description="Monthly, yearly or lifetime plans that unlock every course or the courses you pick, and the members subscribed to them."
        actions={
          tab === "members" ? (
            <>
              {db.subscriptions.length > 0 && (
                <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
                  <Icon.Download className="size-4" />
                  Export CSV
                </a>
              )}
              <GrantMembershipButton members={pickerMembers} plans={plans.map((p) => ({ id: p.id, name: p.name, active: p.active }))} />
            </>
          ) : undefined
        }
      />

      <div className="mb-5 rounded-card border border-border bg-surface-1 px-4 py-3.5 shadow-card sm:px-5">
        <MembershipSalesSwitch enabled={settings.growth.subscriptionsEnabled} />
        <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-sm text-ink-muted">
          <Icon.CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {gateway === "stripe" || gateway === "razorpay"
              ? `New memberships are billed automatically through ${GATEWAY_NAMES[gateway]}: it charges each renewal and this site records it from its webhooks.`
              : gateway === "manual"
                ? "New memberships are paid by hand: members get a renewal order before each period ends, and you confirm the payment under Transactions."
                : "No payment gateway is active, so memberships start without a payment and renew for free."}{" "}
            <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
              {gatewayLabel(gateway)} · change in Payments
            </Link>
          </span>
        </p>
        {gatewayStatus && (!gatewayStatus.configured || !gatewayStatus.webhookConfigured) && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {!gatewayStatus.configured
                ? `${gatewayStatus.label} is not configured, so membership checkouts are unavailable.`
                : `The ${gatewayStatus.label} webhook secret (${gatewayStatus.webhookSecretVar}) is missing. Renewals, failed payments and cancellations made at ${gatewayStatus.label} are only picked up when this page is opened.`}{" "}
              <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
                Set it up in Payments
              </Link>
            </span>
          </p>
        )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Paying members" value={formatNumber(stats.active + stats.pastDue)} hint={stats.pastDue ? `${formatNumber(stats.pastDue)} with a payment due` : "All payments up to date"} icon={<Icon.Users className="size-4" />} />
        <StatCard label="On free trial" value={formatNumber(stats.trialing)} hint="Charged when the trial ends" icon={<Icon.Gift className="size-4" />} />
        <StatCard label="Ending within 7 days" value={formatNumber(stats.endingSoon)} hint="Cancelled, still running" icon={<Icon.Clock className="size-4" />} />
        <StatCard label="Monthly recurring revenue" value={<span className="text-2xl">{mrrLabel}</span>} hint="Yearly plans count as a twelfth" icon={<Icon.TrendingUp className="size-4" />} />
      </div>

      <Tabs
        className="mb-5"
        items={[
          { label: "Plans", value: "plans", count: plans.length },
          { label: "Members", value: "members", count: ongoing },
          { label: "Bundles", value: "bundles", count: db.bundles.length },
        ]}
      />

      {tab === "bundles" ? (
        bundles && (
          <>
            <div className="mb-5 rounded-card border border-border bg-surface-1 px-4 py-3.5 shadow-card sm:px-5">
              <BundleSalesSwitch enabled={settings.growth.bundlesEnabled} />
            </div>
            <BundlesManager
              rows={bundleRows}
              total={bundles.total}
              page={bundles.page}
              pageCount={bundles.pageCount}
              filter={{ status: bundleFilter.status, q: bundleFilter.search ?? "" }}
              courses={bundles.courses}
              currencies={currencyOptions}
              defaultCurrency={settings.commerce.defaultCurrency}
              salesEnabled={settings.growth.bundlesEnabled}
              bundleCount={bundles.stats.total}
            />
          </>
        )
      ) : tab === "plans" ? (
        <PlansManager plans={planRows} courses={courses} currencies={currencyOptions} defaultCurrency={settings.commerce.defaultCurrency} salesEnabled={settings.growth.subscriptionsEnabled} />
      ) : (
        members && (
          <MembershipMembers
            rows={memberRows}
            total={members.total}
            page={members.page}
            pageCount={members.pageCount}
            filter={{ status: filter.status, plan: filter.planId ?? "", gateway: filter.gateway ?? "", q: filter.search ?? "" }}
            plans={plans.map((p) => ({ id: p.id, name: p.name }))}
          />
        )
      )}
    </>
  );
}
