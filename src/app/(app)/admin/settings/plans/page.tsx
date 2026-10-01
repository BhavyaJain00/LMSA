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
import { runInstallmentMaintenance } from "@/lib/commerce/installment-service";
import { getAdminInstallments, getInstallmentCourses, installmentStats, parseInstallmentFilter } from "@/lib/commerce/installment-views";
import { INSTALLMENT_GRACE_DAYS, installmentPlans } from "@/lib/commerce/installments";
import { InstallmentCoursesTable, InstallmentPlansTable, InstallmentSalesSwitch, type InstallmentRowData } from "@/components/commerce/installments-manager";
import { formatNumber } from "@/lib/utils";
import { deliverDueGiftsQuietly, getAdminGifts, parseAdminGiftFilter } from "@/lib/commerce/gift-service";
import { GiftSalesSwitch, GiftsManager, type GiftRowData } from "@/components/commerce/gifts-manager";

export const metadata = { title: "Plans, bundles, installments & gifts" };

const GATEWAY_NAMES: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

export default async function PlansSettingsPage(props: PageProps<"/admin/settings/plans">) {
  await requireRole(["admin"], "/admin/settings/plans");
  const sp = await props.searchParams;
  const tab = sp.tab === "members" || sp.tab === "bundles" || sp.tab === "installments" || sp.tab === "gifts" ? sp.tab : "plans";

  // No scheduler needed: memberships paid by hand move to "payment due" / "ended", renewal orders are
  // opened and missed gateway webhooks are caught up whenever an administrator opens this page.
  await runMembershipMaintenance().catch((error) => {
    console.error("[memberships] maintenance failed:", error instanceof Error ? error.message : String(error));
  });
  // Same for payment plans: reminders, the pause notice and missed Stripe charges.
  if (tab === "installments") {
    await runInstallmentMaintenance().catch((error) => {
      console.error("[installments] maintenance failed:", error instanceof Error ? error.message : String(error));
    });
  }

  // Gifts scheduled for a date that has come are sent when an administrator opens the gifts tab.
  if (tab === "gifts") await deliverDueGiftsQuietly();

  const [{ plans, stats, courses }, db] = await Promise.all([getAdminPlans(), getDb()]);
  const settings = db.settings;
  const gateway = settings.commerce.paymentGateway;
  const gatewayStatus = isRealGateway(gateway) ? getGatewayStatuses().find((g) => g.gateway === gateway) : undefined;
  const ongoing = db.subscriptions.filter((s) => isOngoing(s)).length;
  const runningPlans = installmentStats(installmentPlans(db.payments)).open;
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
  const membersExportHref = `/admin/settings/plans/export${exportQuery.size ? `?${exportQuery}` : ""}`;

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

  const installmentFilter = parseInstallmentFilter(sp);
  const [installments, installmentCourses] = tab === "installments" ? await Promise.all([getAdminInstallments(installmentFilter), getInstallmentCourses()]) : [null, null];
  const installmentRows: InstallmentRowData[] = (installments?.rows ?? []).map((r) => ({
    key: r.key,
    userName: r.userName,
    userEmail: r.userEmail,
    courseTitle: r.courseTitle,
    status: r.status,
    statusLabel: r.statusLabel,
    total: r.total,
    paidCount: r.paidCount,
    partAmount: r.partAmount,
    paidAmount: r.paidAmount,
    outstandingAmount: r.outstandingAmount,
    currency: r.currency,
    nextNumber: r.nextNumber,
    nextDueAt: r.nextDueAt,
    overdueDays: r.overdueDays,
    pausesAt: r.pausesAt,
    autoCharge: r.autoCharge,
    gatewayLabel: r.gatewayLabel,
    startedAt: r.startedAt,
  }));
  const installmentPlanCount = installments?.stats.total ?? 0;

  const giftFilter = parseAdminGiftFilter(sp);
  const gifts = tab === "gifts" ? await getAdminGifts(giftFilter) : null;
  const giftRows: GiftRowData[] = (gifts?.rows ?? []).map((g) => ({
    id: g.id,
    code: g.code,
    itemType: g.itemType,
    title: g.title,
    href: g.href,
    recipientEmail: g.recipientEmail,
    recipientName: g.recipientName,
    message: g.message,
    sendAt: g.sendAt,
    sentAt: g.sentAt,
    redeemedAt: g.redeemedAt,
    redeemedByName: g.redeemedByName,
    purchaserName: g.purchaserName,
    purchaserEmail: g.purchaserEmail,
    orderId: g.orderId,
    amount: g.amount,
    currency: g.currency,
    status: g.status,
    createdAt: g.createdAt,
  }));

  const exportHref = (() => {
    if (tab === "members") return db.subscriptions.length ? membersExportHref : null;
    const qs = new URLSearchParams({ tab });
    if (tab === "bundles") {
      if (!db.bundles.length) return null;
      if (bundleFilter.status !== "all") qs.set("bstatus", bundleFilter.status);
      if (bundleFilter.search) qs.set("bq", bundleFilter.search);
      return `/admin/settings/plans/export?${qs}`;
    }
    if (tab === "installments") {
      if (!installmentPlanCount) return null;
      if (installmentFilter.status !== "open") qs.set("istatus", installmentFilter.status);
      if (installmentFilter.courseId) qs.set("icourse", installmentFilter.courseId);
      if (installmentFilter.search) qs.set("iq", installmentFilter.search);
      return `/admin/settings/plans/export?${qs}`;
    }
    if (tab === "gifts") {
      if (!db.gifts.length) return null;
      if (giftFilter.status !== "all") qs.set("gstatus", giftFilter.status);
      if (giftFilter.search) qs.set("gq", giftFilter.search);
      return `/admin/settings/plans/export?${qs}`;
    }
    return null;
  })();

  const pickerMembers =
    tab === "members"
      ? db.users
          .filter((u) => u.enabled)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((u) => ({ id: u.id, name: u.name, email: u.email, username: u.username, avatarUrl: u.avatarUrl }))
      : [];

  const HEADERS = {
    plans: { title: "Membership plans", description: "Monthly, yearly or lifetime plans that unlock every course or the courses you pick, and the members subscribed to them." },
    members: { title: "Membership plans", description: "Monthly, yearly or lifetime plans that unlock every course or the courses you pick, and the members subscribed to them." },
    bundles: { title: "Course bundles", description: "Several courses sold together for one price. Buyers are enrolled in every course of the bundle at once." },
    installments: {
      title: "Installments",
      description: `Let learners pay a course in equal parts. Access starts with the first payment and pauses when a payment is more than ${INSTALLMENT_GRACE_DAYS} days late.`,
    },
    gifts: {
      title: "Gifts",
      description: "Courses, bundles and memberships bought for someone else. The recipient gets an email with a single-use code on the date the buyer chose.",
    },
  } as const;
  const amountsLabel = (rows: { currency: string; amount: number }[]) =>
    rows.length ? rows.map((o) => money(o.amount, o.currency)).join(" + ") : money(0, settings.commerce.defaultCurrency);

  return (
    <>
      <SettingsPanelHeader
        title={HEADERS[tab].title}
        description={HEADERS[tab].description}
        actions={
          exportHref || tab === "members" ? (
            <>
              {exportHref && (
                <a href={exportHref} className={buttonClasses({ variant: "outline", size: "sm" })} download>
                  <Icon.Download className="size-4" />
                  Export CSV
                </a>
              )}
              {tab === "members" && <GrantMembershipButton members={pickerMembers} plans={plans.map((p) => ({ id: p.id, name: p.name, active: p.active }))} />}
            </>
          ) : undefined
        }
      />

      {tab === "bundles" && bundles ? (
        <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <StatCard label="Bundles" value={formatNumber(bundles.stats.total)} hint={`${formatNumber(bundles.stats.published)} published`} icon={<Icon.Layers className="size-4" />} />
          <StatCard label="Bundles sold" value={formatNumber(bundles.stats.sold)} hint="Paid orders" icon={<Icon.Receipt className="size-4" />} />
          <StatCard label="Bundle revenue" value={<span className="text-2xl">{amountsLabel(bundles.stats.revenue)}</span>} hint="Paid, less refunds" icon={<Icon.TrendingUp className="size-4" />} />
          <StatCard label="Courses available" value={formatNumber(bundles.courses.length)} hint="Can be put in a bundle" icon={<Icon.BookOpen className="size-4" />} />
        </div>
      ) : tab === "gifts" && gifts ? (
        <>
          <div className="mb-5 rounded-card border border-border bg-surface-1 px-4 py-3.5 shadow-card sm:px-5">
            <GiftSalesSwitch enabled={settings.growth.giftsEnabled} />
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Gifts sold" value={formatNumber(gifts.stats.paid)} hint={`${formatNumber(gifts.stats.total)} ordered`} icon={<Icon.Gift className="size-4" />} />
            <StatCard label="Redeemed" value={formatNumber(gifts.stats.redeemed)} hint={gifts.stats.paid ? `${Math.round((gifts.stats.redeemed / gifts.stats.paid) * 100)}% of gifts sold` : "No gifts sold yet"} icon={<Icon.CheckCircle className="size-4" />} />
            <StatCard label="Scheduled" value={formatNumber(gifts.stats.scheduled)} hint="Waiting for their send date" icon={<Icon.Calendar className="size-4" />} />
            <StatCard label="Gift revenue" value={<span className="text-2xl">{amountsLabel(gifts.stats.revenue)}</span>} hint="Paid gift orders" icon={<Icon.TrendingUp className="size-4" />} />
          </div>
        </>
      ) : tab === "installments" && installments ? (
        <>
          <div className="mb-5 rounded-card border border-border bg-surface-1 px-4 py-3.5 shadow-card sm:px-5">
            <InstallmentSalesSwitch enabled={settings.growth.installmentsEnabled} gatewayCollects={gateway !== "none"} />
            <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-sm text-ink-muted">
              <Icon.CreditCard className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                {gateway === "stripe"
                  ? "Stripe charges the remaining payments automatically on their due dates and stops after the last one."
                  : gateway === "razorpay"
                    ? "Learners get an email with a “Pay installment” link before each payment is due, and pay it through Razorpay."
                    : gateway === "manual"
                      ? "Learners get a reminder with the payment instructions before each payment; you confirm each payment under Transactions."
                      : "No payment gateway is active, so checkout cannot offer installments."}{" "}
                <Link href="/admin/settings/payments" className="font-medium text-accent hover:underline">
                  {gatewayLabel(gateway)} · change in Payments
                </Link>
              </span>
            </p>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatCard label="Plans collecting" value={formatNumber(installments.stats.open)} hint={`${formatNumber(installments.stats.completed)} paid in full`} icon={<Icon.Calendar className="size-4" />} />
            <StatCard label="Payment overdue" value={formatNumber(installments.stats.overdue)} hint={`Within the ${INSTALLMENT_GRACE_DAYS}-day grace period`} icon={<Icon.Clock className="size-4" />} />
            <StatCard label="Access paused" value={formatNumber(installments.stats.paused)} hint={`More than ${INSTALLMENT_GRACE_DAYS} days late`} icon={<Icon.Lock className="size-4" />} />
            <StatCard label="Still to collect" value={<span className="text-2xl">{amountsLabel(installments.stats.outstanding)}</span>} hint="On running plans" icon={<Icon.TrendingUp className="size-4" />} />
          </div>
        </>
      ) : (
        <>
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
        </>
      )}

      <Tabs
        className="mb-5"
        items={[
          { label: "Plans", value: "plans", count: plans.length },
          { label: "Members", value: "members", count: ongoing },
          { label: "Bundles", value: "bundles", count: db.bundles.length },
          { label: "Installments", value: "installments", count: runningPlans },
          { label: "Gifts", value: "gifts", count: db.gifts.length },
        ]}
      />

      {tab === "gifts" ? (
        gifts && (
          <GiftsManager
            rows={giftRows}
            total={gifts.total}
            page={gifts.page}
            pageCount={gifts.pageCount}
            filter={{ status: giftFilter.status, q: giftFilter.search ?? "" }}
            giftCount={gifts.stats.total}
          />
        )
      ) : tab === "bundles" ? (
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
      ) : tab === "installments" ? (
        installments &&
        installmentCourses && (
          <div className="space-y-8">
            <section aria-labelledby="installment-plans-heading">
              <h2 id="installment-plans-heading" className="mb-3 text-base font-semibold text-ink">
                Payment plans
              </h2>
              <InstallmentPlansTable
                rows={installmentRows}
                total={installments.total}
                page={installments.page}
                pageCount={installments.pageCount}
                filter={{ status: installmentFilter.status, course: installmentFilter.courseId ?? "", q: installmentFilter.search ?? "" }}
                courses={installments.courses}
                planCount={installmentPlanCount}
              />
            </section>
            <section aria-labelledby="installment-courses-heading">
              <h2 id="installment-courses-heading" className="mb-1 text-base font-semibold text-ink">
                Courses sold in installments
              </h2>
              <p className="mb-3 text-sm text-ink-muted">Set how many payments, how far apart, and any surcharge for paying in parts. Changes apply to new checkouts only.</p>
              <InstallmentCoursesTable courses={installmentCourses} salesEnabled={settings.growth.installmentsEnabled} />
            </section>
          </div>
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
