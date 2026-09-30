import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { verificationError } from "@/lib/auth/verification";
import { getDb } from "@/lib/db/store";
import { checkBillingAccess, computeOrderSummary, getBillingItem, getSavedBillingDetails, installmentCheckout, membershipTerms, parseItemType, validateCouponForBuyer } from "@/lib/data/commerce";
import { gatewayMode, isConfigured } from "@/lib/payments/gateway";
import { intervalNoun, intervalSuffix } from "@/lib/commerce/plans";
import { INSTALLMENT_GRACE_DAYS, intervalPhrase, scheduleDates } from "@/lib/commerce/installments";
import { legalLinks } from "@/lib/legal/links";
import { agreementDocuments } from "@/lib/legal/agreement";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { CouponForm } from "@/components/commerce/coupon-form";
import { BillingForm, type InstallmentCheckoutTerms, type MembershipCheckoutTerms } from "@/components/commerce/billing-form";
import { PaymentOptionPicker } from "@/components/commerce/payment-option-picker";
import { NotPermitted } from "@/components/commerce/not-permitted";
import { FreeEnrollForm } from "@/components/commerce/free-enroll-form";
import { formatDate } from "@/lib/utils";

export const metadata = { title: "Billing Details" };

export default async function BillingPage(props: PageProps<"/billing/[type]/[id]">) {
  const [{ type: rawType, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const type = parseItemType(rawType);
  if (!type) notFound();
  const item = await getBillingItem(type, id);
  if (!item) notFound();

  const basePath = `/billing/${type}/${id}`;
  const header = <PageHeader title="Billing Details" breadcrumbs={<Breadcrumbs items={[{ label: item.plan ? "Membership" : item.name, href: item.href }, { label: "Billing Details" }]} />} />;

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

  const [db, links] = await Promise.all([getDb(), legalLinks()]);
  const settings = db.settings;
  // Memberships that renew are billed at the plan's price every period, so coupons don't apply to them.
  const terms = item.plan ? membershipTerms(db, user.id, item.plan) : null;
  const couponsAllowed = !terms?.recurring;
  const submittedCode = couponsAllowed && typeof sp.coupon === "string" ? sp.coupon.trim().toUpperCase() : "";
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

  const gateway = settings.commerce.paymentGateway;
  // Courses sold in installments: the buyer picks "in full" or "in N payments" (`?pay=installments`).
  const split = installmentCheckout(item, coupon, settings);
  const inParts = split && sp.pay === "installments" ? split : null;
  // What this order charges today: one payment of the plan, or the whole summary.
  const charge = inParts ? inParts.part : { originalAmount: summary.originalAmount, discountAmount: summary.discountAmount, taxAmount: summary.taxAmount, amount: summary.total };
  const paid = charge.amount > 0 && gateway !== "none";
  const priceLabel = money(charge.amount, summary.currency);
  const installments: InstallmentCheckoutTerms | null = inParts ? { count: inParts.plan.count, interval: intervalPhrase(inParts.plan.intervalDays), automatic: gateway === "stripe" } : null;
  const dueDates = inParts ? scheduleDates(new Date().toISOString(), inParts.plan.count, inParts.plan.intervalDays) : [];
  const optionHref = (parts: boolean) => {
    const query = new URLSearchParams();
    if (summary.coupon) query.set("coupon", summary.coupon.code);
    if (parts) query.set("pay", "installments");
    return query.size ? `${basePath}?${query}` : basePath;
  };
  const membership: MembershipCheckoutTerms | null =
    terms && item.plan
      ? {
          planName: item.plan.name,
          recurring: terms.recurring,
          trialDays: paid ? terms.trialDays : 0,
          periodLabel: terms.recurring ? `${priceLabel}${intervalSuffix(terms.interval)}` : priceLabel,
          intervalNoun: intervalNoun(terms.interval),
          firstChargeOn: paid && terms.trialEndsAt ? formatDate(terms.trialEndsAt) : null,
          // Stripe and Razorpay charge the saved payment method every period; other gateways send a renewal order.
          automaticRenewal: terms.recurring && paid && (gateway === "stripe" || gateway === "razorpay"),
        }
      : null;

  return (
    <>
      {header}
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:order-last">
          <OrderSummary
            itemType={item.type}
            title={item.type === "certificate" ? item.name : item.title}
            subtitle={inParts ? `Payment 1 of ${inParts.plan.count}, due today` : item.type === "certificate" ? "Certificate of completion" : item.description}
            imageUrl={item.imageUrl}
            gradient={item.gradient}
            lines={{
              currency: summary.currency,
              originalAmount: charge.originalAmount,
              discountAmount: charge.discountAmount,
              taxAmount: charge.taxAmount,
              taxLabel: summary.taxLabel,
              taxPercentage: summary.taxPercentage,
              total: charge.amount,
              couponCode: summary.coupon?.code,
              usdEquivalent: inParts ? null : summary.usdEquivalent,
            }}
            footer={
              inParts ? (
                <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-ink-muted">
                  <li className="flex items-start gap-2">
                    <Icon.Calendar className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span>
                      <strong className="text-ink">
                        {inParts.plan.count} payments of {priceLabel}
                      </strong>{" "}
                      {intervalPhrase(inParts.plan.intervalDays)}: today, then{" "}
                      {dueDates
                        .slice(1)
                        .map((d) => formatDate(d))
                        .join(", ")}
                      .
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon.Receipt className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span>
                      {money(inParts.total, summary.currency)} in total
                      {inParts.total > summary.total ? `, ${money(inParts.total - summary.total, summary.currency)} more than paying in full.` : ", the same as paying in full."}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Icon.Unlock className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span>
                      Full access from the first payment. If a payment is more than {INSTALLMENT_GRACE_DAYS} days late, the lessons lock until it is paid; your progress is kept.
                    </span>
                  </li>
                </ul>
              ) : membership ? (
                <ul className="mt-4 space-y-2 border-t border-border pt-4 text-sm text-ink-muted">
                  {membership.trialDays > 0 && (
                    <li className="flex items-start gap-2">
                      <Icon.Gift className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                      <span>
                        <strong className="text-ink">{membership.trialDays}-day free trial.</strong> Nothing is charged today; the first payment of {priceLabel} is due on{" "}
                        {membership.firstChargeOn}.
                      </span>
                    </li>
                  )}
                  <li className="flex items-start gap-2">
                    <Icon.Refresh className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                    <span>
                      {membership.recurring
                        ? membership.automaticRenewal
                          ? `Renews automatically at ${membership.periodLabel} until you cancel.`
                          : `${membership.periodLabel}. We send you a renewal order before each ${membership.intervalNoun} ends.`
                        : "One payment, lifetime access. It never renews."}
                    </span>
                  </li>
                  {membership.recurring && (
                    <li className="flex items-start gap-2">
                      <Icon.XCircle className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden="true" />
                      <span>Cancel any time from Settings → Membership. You keep access until the period you paid for ends.</span>
                    </li>
                  )}
                </ul>
              ) : undefined
            }
          />
          {couponsAllowed && (
            <CouponForm basePath={basePath} appliedCode={summary.coupon?.code ?? null} error={couponError} submittedCode={submittedCode} keep={inParts ? "pay=installments" : ""} />
          )}
          <p className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-ink">
            <Icon.AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            Please ensure that the billing name you enter is correct, as it will be used on your invoice.
          </p>
        </aside>
        <div className="min-w-0">
          {split && (
            <PaymentOptionPicker
              className="mb-5"
              options={[
                {
                  href: optionHref(false),
                  active: !inParts,
                  title: "Pay in full",
                  price: money(summary.total, summary.currency),
                  note: "One payment today. The course is yours for good.",
                  icon: <Icon.CreditCard className="size-5" />,
                },
                {
                  href: optionHref(true),
                  active: !!inParts,
                  title: `Pay in ${split.plan.count} installments`,
                  price: `${split.plan.count} × ${money(split.part.amount, summary.currency)}`,
                  note: `One payment ${intervalPhrase(split.plan.intervalDays)}, ${money(split.total, summary.currency)} in total${split.plan.surchargePercent > 0 ? ` (includes a ${split.plan.surchargePercent}% plan fee)` : ""}.`,
                  icon: <Icon.Calendar className="size-5" />,
                },
              ]}
            />
          )}
          <BillingForm
            itemType={item.type}
            itemId={item.id}
            couponCode={summary.coupon?.code ?? ""}
            expectedTotal={charge.amount}
            totalLabel={priceLabel}
            gateway={gateway}
            gatewayReady={isConfigured(gateway)}
            gatewayMode={gatewayMode(gateway)}
            applyTax={settings.commerce.applyTax}
            taxLabel={settings.commerce.taxLabel}
            contactEmail={settings.contact.email}
            legal={agreementDocuments("checkout", links)}
            membership={membership}
            installments={installments}
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
