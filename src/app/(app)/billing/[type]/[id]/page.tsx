import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { verificationError } from "@/lib/auth/verification";
import { getSettings } from "@/lib/db/store";
import { checkBillingAccess, computeOrderSummary, getBillingItem, getSavedBillingDetails, parseItemType, validateCouponForBuyer } from "@/lib/data/commerce";
import { gatewayMode, isConfigured } from "@/lib/payments/gateway";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { CouponForm } from "@/components/commerce/coupon-form";
import { BillingForm } from "@/components/commerce/billing-form";
import { NotPermitted } from "@/components/commerce/not-permitted";
import { FreeEnrollForm } from "@/components/commerce/free-enroll-form";

export const metadata = { title: "Billing Details" };

export default async function BillingPage(props: PageProps<"/billing/[type]/[id]">) {
  const [{ type: rawType, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const type = parseItemType(rawType);
  if (!type) notFound();
  const item = await getBillingItem(type, id);
  if (!item) notFound();

  const basePath = `/billing/${type}/${id}`;
  const header = <PageHeader title="Billing Details" breadcrumbs={<Breadcrumbs items={[{ label: item.name, href: item.href }, { label: "Billing Details" }]} />} />;

  const user = await getCurrentUser();
  if (!user) {
    return (
      <>
        {header}
        <NotPermitted message="Please login to access this page." actionHref={`/login?next=${encodeURIComponent(basePath)}`} actionLabel="Login" />
      </>
    );
  }

  const access = await checkBillingAccess(user, item);
  if (access.status === "owned") redirect(access.redirectTo);
  if (access.status === "pending") redirect(`/billing/success/${access.payment.orderId}`);
  if (access.status === "free") {
    if (type !== "course" || !item.course) redirect(access.redirectTo);
    return (
      <>
        {header}
        <div className="mx-auto my-12 w-full max-w-md rounded-card border border-border bg-surface-1 p-6 shadow-card">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <Icon.Gift className="size-5 text-success" />
            This course is free.
          </h2>
          <p className="mt-2 text-sm text-ink-muted">No payment is needed for {item.name}. Enroll directly and start learning.</p>
          <FreeEnrollForm slug={item.course.slug} />
        </div>
      </>
    );
  }
  if (access.status === "denied") {
    return (
      <>
        {header}
        <NotPermitted message={access.message} actionHref={access.backHref} actionLabel={access.backLabel} />
      </>
    );
  }

  // Purchasing is blocked until the member confirms their email (when the platform requires it).
  const blocked = await verificationError(user);
  if (blocked) {
    return (
      <>
        {header}
        <NotPermitted message={blocked} actionHref="/settings/security" actionLabel="Go to security settings" />
      </>
    );
  }

  const settings = await getSettings();
  const submittedCode = typeof sp.coupon === "string" ? sp.coupon.trim().toUpperCase() : "";
  let coupon = null;
  let couponError: string | null = null;
  if (submittedCode) {
    // Rate limited per buyer and IP, so codes cannot be guessed by trying them one after another.
    const check = await validateCouponForBuyer(submittedCode, item, { userId: user.id });
    if (check.ok) coupon = check.coupon;
    else couponError = check.error;
  }
  const summary = computeOrderSummary(item, coupon, settings);
  const saved = await getSavedBillingDetails(user.id);

  return (
    <>
      {header}
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:order-last">
          <OrderSummary
            itemType={item.type}
            title={item.type === "certificate" ? item.name : item.title}
            subtitle={item.type === "certificate" ? "Certificate of completion" : item.description}
            imageUrl={item.imageUrl}
            gradient={item.gradient}
            lines={{
              currency: summary.currency,
              originalAmount: summary.originalAmount,
              discountAmount: summary.discountAmount,
              taxAmount: summary.taxAmount,
              taxLabel: summary.taxLabel,
              taxPercentage: summary.taxPercentage,
              total: summary.total,
              couponCode: summary.coupon?.code,
              usdEquivalent: summary.usdEquivalent,
            }}
          />
          <CouponForm basePath={basePath} appliedCode={summary.coupon?.code ?? null} error={couponError} submittedCode={submittedCode} />
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            Please ensure that the billing name you enter is correct, as it will be used on your invoice.
          </p>
        </aside>
        <div className="min-w-0">
          <BillingForm
            itemType={item.type}
            itemId={item.id}
            couponCode={summary.coupon?.code ?? ""}
            expectedTotal={summary.total}
            totalLabel={money(summary.total, summary.currency)}
            gateway={settings.commerce.paymentGateway}
            gatewayReady={isConfigured(settings.commerce.paymentGateway)}
            gatewayMode={gatewayMode(settings.commerce.paymentGateway)}
            applyTax={settings.commerce.applyTax}
            taxLabel={settings.commerce.taxLabel}
            contactEmail={settings.contact.email}
            defaults={{
              billingName: saved?.billingName ?? user.name,
              line1: saved?.address?.line1 ?? "",
              line2: saved?.address?.line2 ?? "",
              city: saved?.address?.city ?? "",
              state: saved?.address?.state ?? "",
              country: saved?.address?.country ?? "",
              pincode: saved?.address?.pincode ?? "",
              gstin: saved?.gstin ?? "",
              pan: saved?.pan ?? "",
              source: saved?.source ?? "",
            }}
          />
        </div>
      </div>
    </>
  );
}
