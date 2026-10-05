import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isAdmin, requireUser } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { gatewayLabel, getBillingItem, getPaymentByOrderId, isScheduledPart, ITEM_TYPE_LABELS } from "@/lib/data/commerce";
import { getNextLesson, lessonHref } from "@/lib/data/courses";
import { backfillInvoiceNumbers, formatAddressLines, hasInvoice, needsInvoiceNumber } from "@/lib/payments/invoice";
import { isRealGateway, syncPaymentStatus } from "@/lib/payments/gateway";
import { restoreOrderAccess } from "@/lib/payments/fulfillment";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/card";
import { Icon } from "@/components/ui/icons";
import { Breadcrumbs, DetailItem } from "@/components/admin/settings/settings-ui";
import { OrderSummary, money } from "@/components/commerce/order-summary";
import { PaymentStatusBadge } from "@/components/commerce/status-badge";
import { CancelOrderButton } from "@/components/commerce/order-actions";
import { ResumePaymentButton } from "@/components/commerce/resume-payment-button";
import { isLifetime, subscriptionGrantsAccess } from "@/lib/commerce/subscriptions";
import { bundleCourses } from "@/lib/commerce/bundles";
import { isCancelledPart, isInstallmentOrder } from "@/lib/commerce/installments";
import { getPlanViewForOrder } from "@/lib/commerce/installment-views";
import { InstallmentPlanCard } from "@/components/commerce/installment-plan-card";
import { deliveryLabel, getGiftForOrder } from "@/lib/commerce/gift-service";
import { GIFT_STATUS_LABELS } from "@/lib/commerce/gifts";
import { bumpsOf, chargeAmount, isOrderBump } from "@/lib/commerce/upsells";
import { postPurchaseOfferFor } from "@/lib/commerce/upsell-service";
import { PostPurchaseOffer } from "@/components/commerce/post-purchase-offer";
import { formatDate, formatDateTime } from "@/lib/utils";
import { purchaseEventParams } from "@/lib/seo/tracking";
import { TrackEvent } from "@/components/seo/track-event";
import { isTaxInclusive } from "@/lib/commerce/tax";

export const metadata = { title: "Order" };

const GATEWAY_NAME: Record<string, string> = { stripe: "Stripe", razorpay: "Razorpay" };

export default async function OrderPage(props: PageProps<"/billing/success/[orderId]">) {
  const { orderId } = await props.params;
  const user = await requireUser(`/billing/success/${encodeURIComponent(orderId)}`);
  const found = await getPaymentByOrderId(orderId);
  if (!found || (found.userId !== user.id && !isAdmin(user))) notFound();

  // A learner coming back from Stripe/Razorpay before the webhook arrived: ask the gateway directly.
  let processing = false;
  if (found.status === "pending" && isRealGateway(found.gateway) && found.gatewayOrderId) {
    const state = await syncPaymentStatus({ ...found }, { timeoutMs: 6_000 });
    processing = state.state === "processing";
  }
  if (needsInvoiceNumber(found)) await backfillInvoiceNumbers();
  const payment = (await getPaymentByOrderId(orderId)) ?? found;
  // A paid order whose access could not be granted earlier (admins were alerted): try again now.
  const accessPending = payment.status === "paid" && payment.userId === user.id && payment.itemType !== "batch" && !(await restoreOrderAccess(payment.id));

  const db = await getDb();
  const item = await getBillingItem(payment.itemType, payment.itemId);
  const own = payment.userId === user.id;
  const settings = db.settings;
  // Courses paid in installments: the plan this order is a part of, and whether it is one of the later parts.
  const plan = await getPlanViewForOrder(payment);
  const laterPart = isInstallmentOrder(payment) && payment.installmentNumber! > 1;
  const partLabel = plan ? `Payment ${payment.installmentNumber} of ${plan.total}` : "";
  // A later part of a plan that is not due yet.
  const dueInFuture = isScheduledPart(payment);
  // Gift orders: the gift they bought (recipient, delivery, code).
  const gift = await getGiftForOrder(payment);
  const giftRow = gift ? db.gifts.find((g) => g.id === gift.id) : undefined;
  const checkoutHref = gift && giftRow ? `/gift?type=${giftRow.itemType}&id=${encodeURIComponent(giftRow.itemId)}` : `/billing/${payment.itemType}/${payment.itemId}${plan ? "?pay=installments" : ""}`;
  // Order bumps: add-ons charged with this order, or the main order of an add-on.
  const bump = isOrderBump(payment);
  const mainOrder = bump ? (db.payments.find((p) => p.id === payment.upsellOfPaymentId) ?? null) : null;
  const addOns = bump ? [] : bumpsOf(db.payments, payment).filter((b) => b.status !== "failed" || payment.status === "failed");
  const toCollect = bump ? payment.amount : chargeAmount(db.payments, payment);
  const upsellOffer = payment.userId === user.id && !bump ? await postPurchaseOfferFor(user, payment) : null;
  const invoiceHref = `/billing/invoice/${encodeURIComponent(payment.orderId)}`;
  const invoiced = hasInvoice(payment);
  const online = isRealGateway(payment.gateway);
  const gatewayName = GATEWAY_NAME[payment.gateway] ?? gatewayLabel(payment.gateway);
  // Membership orders: the membership this order started or renewed.
  const membership = payment.itemType === "plan" && payment.subscriptionId ? (db.subscriptions.find((s) => s.id === payment.subscriptionId) ?? null) : null;
  const membershipPlan = payment.itemType === "plan" ? (db.plans.find((p) => p.id === (payment.planId ?? payment.itemId)) ?? null) : null;
  const trialRunning = !!membership && membership.status === "trialing" && subscriptionGrantsAccess(membership);

  // Next steps for the order.
  const actions: ReactNode[] = [];
  let heading = "";
  let message: ReactNode = null;
  let tone: "success" | "warning" | "neutral" | "danger" = "success";

  if (payment.status === "paid") {
    heading = payment.amount > 0 ? "Payment successful" : "You're enrolled";
    if (payment.itemType === "course" && item?.course) {
      const course = item.course;
      const next = own ? await getNextLesson(course, user) : null;
      if (plan && plan.status === "completed") {
        heading = payment.amount > 0 ? "Paid in full" : "Nothing more to pay";
        message = <>All {plan.total} payments for <strong className="text-ink">{course.title}</strong> are settled. The course is yours for good.</>;
      } else if (plan && (plan.status === "paused" || plan.status === "cancelled")) {
        tone = "warning";
        heading = `${partLabel} received`;
        message =
          plan.status === "paused" ? (
            <>This payment is in, but a later one is overdue, so the lessons of <strong className="text-ink">{course.title}</strong> are locked until it is paid.</>
          ) : (
            <>This payment was received before the plan for <strong className="text-ink">{course.title}</strong> was cancelled. The lessons are locked; your progress is saved.</>
          );
      } else if (plan) {
        heading = `${partLabel} received`;
        message = <>You have full access to <strong className="text-ink">{course.title}</strong> while your payment plan is up to date. Happy learning!</>;
      } else {
        message = <>You now have full access to <strong className="text-ink">{course.title}</strong>. Happy learning!</>;
      }
      // While the plan is paused or cancelled the lessons are locked: only the course page is offered.
      if (!plan || (plan.status !== "paused" && plan.status !== "cancelled")) {
        actions.push(
          <ButtonLink key="go" href={next ? lessonHref(course.slug, next) : `/courses/${course.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Start learning
          </ButtonLink>,
        );
      }
      actions.push(
        <ButtonLink key="course" href={`/courses/${course.slug}`} variant="outline">
          Go to course
        </ButtonLink>,
      );
    } else if (payment.itemType === "bundle" && item?.bundle) {
      const included = bundleCourses(item.bundle, db.courses).filter((c) => c.published);
      message = (
        <>
          You now have full access to {included.length === 1 ? "the course" : `all ${included.length} courses`} of <strong className="text-ink">{item.bundle.title}</strong>. They are
          yours for good.
        </>
      );
      const first = included[0];
      if (first) {
        actions.push(
          <ButtonLink key="go" href={`/courses/${first.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Start with {first.title}
          </ButtonLink>,
        );
      }
      actions.push(
        <ButtonLink key="bundle" href={item.href} variant="outline">
          View the bundle
        </ButtonLink>,
      );
    } else if (payment.itemType === "batch" && item?.batch) {
      const batch = item.batch;
      const seated = db.batchEnrollments.some((e) => e.batchId === batch.id && e.userId === payment.userId);
      message = seated ? (
        <>Your seat in <strong className="text-ink">{batch.title}</strong> is confirmed. It starts on {batch.startDate} at {batch.startTime} ({batch.timezone}).</>
      ) : (
        <>Your payment was recorded, but a seat in <strong className="text-ink">{batch.title}</strong> could not be allocated. Our team will contact you.</>
      );
      if (!seated) tone = "warning";
      actions.push(
        <ButtonLink key="go" href={`/batches/${batch.slug}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
          Go to batch
        </ButtonLink>,
      );
    } else if (payment.itemType === "certificate" && item?.course) {
      const course = item.course;
      const cert = db.certificates.find((c) => c.userId === payment.userId && c.courseId === course.id && c.published);
      if (cert) {
        message = <>Your certificate for <strong className="text-ink">{course.title}</strong> is ready.</>;
        actions.push(
          <ButtonLink key="cert" href={`/certificates/${cert.code}`} leftIcon={<Icon.Certificate className="size-4" />}>
            View certificate
          </ButtonLink>,
        );
      } else {
        message = <>Your certificate is unlocked. Finish every lesson of <strong className="text-ink">{course.title}</strong> to receive it.</>;
        actions.push(
          <ButtonLink key="cert" href={`/courses/${course.slug}/certification`} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Go to certification
          </ButtonLink>,
          <ButtonLink key="course" href={`/courses/${course.slug}`} variant="outline">
            Continue the course
          </ButtonLink>,
        );
      }
    } else if (payment.itemType === "plan") {
      const planName = membershipPlan?.name ?? payment.itemTitle;
      if (membership && subscriptionGrantsAccess(membership)) {
        heading = trialRunning ? "Your free trial has started" : payment.source === "Renewal" ? "Membership renewed" : payment.amount > 0 ? "Payment successful" : "Your membership is active";
        message = isLifetime(membershipPlan) ? (
          <>You have lifetime access through <strong className="text-ink">{planName}</strong>. Open any included course and start learning.</>
        ) : trialRunning ? (
          <>
            Your trial of <strong className="text-ink">{planName}</strong> runs until {formatDate(membership.currentPeriodEnd)}. Every included course is unlocked; cancel before that
            date and you won&apos;t be charged.
          </>
        ) : (
          <>
            Your <strong className="text-ink">{planName}</strong> membership is active until {formatDate(membership.currentPeriodEnd)}
            {membership.cancelAtPeriodEnd ? "." : " and renews then."} Open any included course and start learning.
          </>
        );
        actions.push(
          <ButtonLink key="courses" href="/courses" rightIcon={<Icon.ArrowRight className="size-4" />}>
            Browse courses
          </ButtonLink>,
        );
      } else {
        tone = "neutral";
        heading = "Membership ended";
        message = <>This order paid for <strong className="text-ink">{planName}</strong>, which is no longer running. Your progress is saved if you join again.</>;
        actions.push(
          <ButtonLink key="plans" href="/pricing">
            See membership plans
          </ButtonLink>,
        );
      }
      if (own) {
        actions.push(
          <ButtonLink key="manage" href="/settings/subscription" variant="outline" leftIcon={<Icon.Star className="size-4" />}>
            Manage membership
          </ButtonLink>,
        );
      }
    } else if (payment.itemType === "seats") {
      const team = db.organizations.find((o) => o.id === payment.orgId) ?? null;
      message = team ? (
        <>
          {payment.seats ? `${payment.seats} ${payment.seats === 1 ? "seat" : "seats"}` : "The seats"} for <strong className="text-ink">{team.name}</strong> are ready. Invite your team members so they can start learning.
        </>
      ) : (
        <>Thanks for your purchase of {payment.itemTitle}.</>
      );
      if (team && own) {
        actions.push(
          <ButtonLink key="team" href={`/team?org=${encodeURIComponent(team.slug)}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
            Invite your team
          </ButtonLink>,
        );
      }
    } else if (gift) {
      heading = gift.status === "redeemed" ? "Your gift was redeemed" : gift.status === "scheduled" ? "Your gift is scheduled" : "Your gift is on its way";
      message = (
        <>
          <strong className="text-ink">{gift.title}</strong> for {gift.recipientName ? `${gift.recipientName} (${gift.recipientEmail})` : gift.recipientEmail}.{" "}
          {gift.status === "redeemed" ? `${gift.redeemedByName ?? "They"} redeemed it on ${formatDate(gift.redeemedAt!)}.` : `${deliveryLabel(gift)}. They redeem it with the code in the email.`}
        </>
      );
      actions.push(
        <ButtonLink key="gifts" href="/gift" leftIcon={<Icon.Gift className="size-4" />}>
          Manage your gifts
        </ButtonLink>,
      );
    } else {
      message = <>Thanks for your purchase of {payment.itemTitle}.</>;
    }
    if (accessPending) {
      tone = "warning";
      heading = "Payment received";
      message = <>Your payment was received, but we couldn&apos;t finish setting up your access to <strong className="text-ink">{payment.itemTitle}</strong> yet. Our team has been notified and will sort it out shortly.</>;
      actions.length = 0;
    }
    if (invoiced && payment.amount > 0) {
      actions.push(
        <ButtonLink key="invoice" href={invoiceHref} variant="outline" leftIcon={<Icon.Receipt className="size-4" />}>
          View invoice
        </ButtonLink>,
      );
    }
  } else if (payment.status === "pending" && laterPart && plan) {
    // A later part of a payment plan: paid from the plan card below (or charged by Stripe on its date).
    tone = dueInFuture ? "neutral" : "warning";
    heading = dueInFuture ? `${partLabel} is scheduled` : `${partLabel} is due`;
    message = dueInFuture ? (
      <>
        <strong className="text-ink">{money(payment.amount, payment.currency)}</strong> for {plan.courseTitle} is due on {formatDate(payment.createdAt)}.{" "}
        {plan.autoCharge ? "It is charged to your card automatically on that day." : "You can pay it early whenever you like."}
      </>
    ) : (
      <>
        <strong className="text-ink">{money(payment.amount, payment.currency)}</strong> for {plan.courseTitle} was due on {formatDate(payment.createdAt)}.{" "}
        {plan.status === "paused" ? "The lessons are locked until it is paid." : "Pay it to keep your access without interruption."}
      </>
    );
  } else if (payment.status === "pending" && bump && mainOrder) {
    tone = "warning";
    heading = "Paid together with your order";
    message = (
      <>
        This add-on is charged in the same payment as order <span className="font-mono font-semibold text-ink">{mainOrder.orderId}</span> and unlocks as soon as that order is paid.
      </>
    );
    actions.push(
      <ButtonLink key="main" href={`/billing/success/${encodeURIComponent(mainOrder.orderId)}`} rightIcon={<Icon.ArrowRight className="size-4" />}>
        Go to the order
      </ButtonLink>,
    );
  } else if (payment.status === "pending" && online) {
    tone = "warning";
    if (processing) {
      heading = "Payment processing";
      message = (
        <>
          {gatewayName} is still confirming your payment of <strong className="text-ink">{money(toCollect, payment.currency)}</strong>. Some payment methods take a few
          minutes (bank debits can take a few days). You&apos;ll be enrolled and notified automatically.
        </>
      );
    } else {
      heading = "Complete your payment";
      message = (
        <>
          Your order is saved, but the payment of <strong className="text-ink">{money(toCollect, payment.currency)}</strong> hasn&apos;t been completed yet. Nothing has
          been charged. Continue with {gatewayName} to get access.
        </>
      );
    }
  } else if (payment.status === "pending") {
    tone = "warning";
    heading = "Order placed — awaiting confirmation";
    message = (
      <>
        Complete your payment of <strong className="text-ink">{money(toCollect, payment.currency)}</strong> and include your order ID{" "}
        <span className="font-mono font-semibold text-ink">{payment.orderId}</span> as the reference.{" "}
        {payment.itemType === "plan"
          ? trialRunning && membership
            ? `Your free trial is already running until ${formatDate(membership.currentPeriodEnd)}; the membership continues once an administrator confirms the payment.`
            : payment.source === "Renewal"
              ? "Your membership is extended as soon as an administrator confirms the payment."
              : "Your membership starts as soon as an administrator confirms the payment."
          : gift
            ? "Your gift is sent as soon as an administrator confirms the payment."
            : "You'll be enrolled automatically and notified as soon as an administrator confirms the payment."}
      </>
    );
    if (payment.itemType === "plan" && own && membership) {
      actions.push(
        <ButtonLink key="manage" href="/settings/subscription" variant="outline" leftIcon={<Icon.Star className="size-4" />}>
          Manage membership
        </ButtonLink>,
      );
    }
  } else if (payment.status === "failed" && laterPart && plan) {
    if (isCancelledPart(payment)) {
      tone = "neutral";
      heading = `${partLabel} was cancelled`;
      message = <>The payment plan for {plan.courseTitle} was cancelled, so this payment is no longer due and nothing will be charged for it.</>;
    } else {
      tone = "danger";
      heading = `${partLabel} didn't go through`;
      message = (
        <>
          {payment.failureReason ? <span className="text-ink">{payment.failureReason} </span> : null}
          Nothing was charged. You can pay it again below, with the same or another payment method.
        </>
      );
    }
  } else if (payment.status === "failed") {
    tone = payment.failureReason ? "danger" : "neutral";
    heading = payment.failureReason ? "Payment failed" : "Order cancelled";
    message = payment.failureReason ? (
      <>
        The payment didn&apos;t go through: <span className="text-ink">{payment.failureReason}</span> Nothing was charged for this order. You can try again with the same or
        another payment method.
      </>
    ) : (
      <>This order was cancelled and no payment is expected. You can check out again whenever you&apos;re ready.</>
    );
    if (own && item) {
      actions.push(
        <ButtonLink key="again" href={checkoutHref}>
          {payment.failureReason ? "Try again" : "Checkout again"}
        </ButtonLink>,
      );
    }
  } else {
    tone = "danger";
    const partial = payment.refundedAmount !== undefined && payment.refundedAmount > 0 && payment.refundedAmount < payment.amount;
    heading = partial ? "Order partially refunded" : "Order refunded";
    message = (
      <>
        {money(payment.refundedAmount ?? payment.amount, payment.currency)} was refunded
        {payment.refundedAt ? ` on ${formatDateTime(payment.refundedAt)}` : ""} and the access this order granted has been removed.
        {isRealGateway(payment.gateway) && payment.refundId ? " Refunds usually reach your account within 5–10 business days." : ""}
      </>
    );
    if (invoiced) {
      actions.push(
        <ButtonLink key="invoice" href={invoiceHref} variant="outline" leftIcon={<Icon.Receipt className="size-4" />}>
          View invoice
        </ButtonLink>,
      );
    }
    if (own && item) {
      actions.push(
        <ButtonLink key="again" href={checkoutHref} variant="outline">
          Buy again
        </ButtonLink>,
      );
    }
  }

  const toneClasses = {
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    neutral: "bg-surface-2 text-ink-muted",
    danger: "bg-danger/12 text-danger",
  }[tone];
  const toneIcon = {
    success: <Icon.CheckCircle className="size-7" />,
    warning: <Icon.Clock className="size-7" />,
    neutral: dueInFuture && payment.status === "pending" ? <Icon.Calendar className="size-7" /> : <Icon.XCircle className="size-7" />,
    danger: payment.status === "refunded" ? <Icon.Refresh className="size-7" /> : <Icon.AlertCircle className="size-7" />,
  }[tone];

  const address = formatAddressLines(payment.address).join(", ");
  // Later parts of a plan are paid from the plan card and cannot be cancelled one by one.
  const showPendingActions = own && payment.status === "pending" && !laterPart && !bump;

  return (
    <>
      {own && payment.status === "paid" && payment.amount > 0 && <TrackEvent event="purchase" params={purchaseEventParams(payment)} onceKey={`purchase:${payment.orderId}`} />}
      <PageHeader
        title="Order"
        breadcrumbs={<Breadcrumbs items={[own ? { label: "Orders", href: "/billing/history" } : { label: "Transactions", href: "/admin/settings/transactions" }, { label: payment.orderId }]} />}
        actions={
          invoiced && payment.amount > 0 ? (
            <ButtonLink href={invoiceHref} variant="outline" size="sm" leftIcon={<Icon.Receipt className="size-4" />}>
              Invoice {payment.invoiceNumber}
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="grid gap-6 pb-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-status-heading">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <span className={`flex size-14 shrink-0 items-center justify-center rounded-full ${toneClasses}`}>{toneIcon}</span>
              <div className="min-w-0">
                <h2 id="order-status-heading" className="text-xl font-semibold tracking-tight text-ink">
                  {heading}
                </h2>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{message}</p>
                {!own && (
                  <p className="mt-2 text-xs text-ink-muted">
                    You are viewing another member&apos;s order as an administrator.{" "}
                    <Link href={`/admin/settings/transactions?search=${encodeURIComponent(payment.orderId)}`} className="font-medium text-accent hover:underline">
                      Open in Transactions
                    </Link>
                  </p>
                )}
                {(actions.length > 0 || showPendingActions) && (
                  <div className="mt-5 flex flex-wrap items-start gap-2">
                    {showPendingActions && online && !processing && <ResumePaymentButton orderId={payment.orderId} gateway={payment.gateway} />}
                    {actions}
                    {showPendingActions && !processing && <CancelOrderButton orderId={payment.orderId} online={online} gateway={payment.gateway} />}
                  </div>
                )}
              </div>
            </div>
            {payment.status === "pending" && !online && !bump && (
              <div className="mt-6 rounded-xl border border-border bg-surface-2 p-4 text-sm">
                <p className="font-medium text-ink">How to pay</p>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-ink-muted">
                  <li>
                    Transfer <strong className="text-ink">{money(toCollect, payment.currency)}</strong> using the payment details shared by our team.
                  </li>
                  <li>
                    Use <span className="font-mono text-ink">{payment.orderId}</span> as the payment reference.
                  </li>
                  <li>
                    {payment.itemType === "plan"
                      ? "We confirm the payment and your membership continues — you'll get a notification."
                      : laterPart
                        ? "We confirm the payment and your plan continues — you'll get a notification."
                        : "We confirm the payment and enroll you — you'll get a notification."}
                  </li>
                </ol>
                {(settings.contact.email || settings.contact.url) && (
                  <p className="mt-3 text-ink-muted">
                    Need the payment details or have a question?{" "}
                    {settings.contact.email ? (
                      <a href={`mailto:${settings.contact.email}?subject=${encodeURIComponent(`Payment for order ${payment.orderId}`)}`} className="font-medium text-accent hover:underline">
                        {settings.contact.email}
                      </a>
                    ) : (
                      <a href={settings.contact.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
                        Contact us
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}
          </section>

          {upsellOffer && (
            <PostPurchaseOffer
              offer={{
                orderId: payment.orderId,
                headline: upsellOffer.upsell.headline,
                title: upsellOffer.item.title,
                description: upsellOffer.item.description,
                href: upsellOffer.item.href,
                imageUrl: upsellOffer.item.imageUrl,
                priceLabel: money(upsellOffer.summary.total, upsellOffer.summary.currency),
                listPriceLabel: upsellOffer.listTotal > upsellOffer.summary.total ? money(upsellOffer.listTotal, upsellOffer.summary.currency) : null,
                discountPercent: upsellOffer.upsell.discountPercent,
                gateway: settings.commerce.paymentGateway,
              }}
            />
          )}

          {addOns.length > 0 && (
            <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-addons-heading">
              <h2 id="order-addons-heading" className="text-base font-semibold text-ink">
                Also in this order
              </h2>
              <ul className="mt-3 divide-y divide-border">
                {addOns.map((a) => (
                  <li key={a.id} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/billing/success/${encodeURIComponent(a.orderId)}`} className="min-w-0 truncate text-sm font-medium text-ink hover:text-accent hover:underline">
                      {a.itemTitle}
                    </Link>
                    <span className="flex items-center gap-2 text-sm tabular-nums text-ink-muted">
                      {money(a.amount, a.currency)}
                      <PaymentStatusBadge status={a.status} failureReason={a.failureReason} refundedAmount={a.refundedAmount} amount={a.amount} audience="learner" />
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 border-t border-border pt-3 text-sm text-ink-muted">
                Charged together: <strong className="text-ink">{money(toCollect, payment.currency)}</strong>. Each item has its own order and invoice.
              </p>
            </section>
          )}

          {gift && (
            <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-gift-heading">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="order-gift-heading" className="text-base font-semibold text-ink">
                  The gift
                </h2>
                <span className="text-xs font-medium text-ink-muted">{GIFT_STATUS_LABELS[gift.status]}</span>
              </div>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <DetailItem label="Gift">
                  <Link href={gift.href} className="text-accent hover:underline">
                    {gift.title}
                  </Link>
                </DetailItem>
                <DetailItem label="Recipient">{gift.recipientName ? `${gift.recipientName} · ${gift.recipientEmail}` : gift.recipientEmail}</DetailItem>
                <DetailItem label="Delivery">{deliveryLabel(gift)}</DetailItem>
                {own && payment.status === "paid" && gift.status !== "redeemed" && (
                  <DetailItem label="Gift code">
                    <span className="font-mono">{gift.code}</span>
                  </DetailItem>
                )}
                {gift.message && <DetailItem label="Your message">{gift.message}</DetailItem>}
              </dl>
            </section>
          )}

          {plan && <InstallmentPlanCard plan={plan} own={own} currentOrderId={payment.orderId} />}

          <section className="rounded-card border border-border bg-surface-1 p-6 shadow-card" aria-labelledby="order-details-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="order-details-heading" className="text-base font-semibold text-ink">
                Order details
              </h2>
              <PaymentStatusBadge status={payment.status} failureReason={payment.failureReason} refundedAmount={payment.refundedAmount} amount={payment.amount} audience="learner" />
            </div>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailItem label="Order ID">
                <span className="font-mono">{payment.orderId}</span>
              </DetailItem>
              <DetailItem label={laterPart ? "Due on" : "Placed on"}>{laterPart ? formatDate(payment.createdAt) : formatDateTime(payment.createdAt)}</DetailItem>
              <DetailItem label="Item">
                {item ? (
                  <Link href={item.href} className="text-accent hover:underline">
                    {ITEM_TYPE_LABELS[payment.itemType]} · {payment.itemTitle}
                  </Link>
                ) : (
                  <>
                    {ITEM_TYPE_LABELS[payment.itemType]} · {payment.itemTitle}
                  </>
                )}
              </DetailItem>
              <DetailItem label="Payment method">{gatewayLabel(payment.gateway)}</DetailItem>
              <DetailItem label="Billing name">{payment.billingName}</DetailItem>
              <DetailItem label="Billing address">{address || "—"}</DetailItem>
              {payment.paidAt && <DetailItem label="Paid on">{formatDateTime(payment.paidAt)}</DetailItem>}
              {payment.invoiceNumber && (
                <DetailItem label="Invoice">
                  <Link href={invoiceHref} className="font-mono text-accent hover:underline">
                    {payment.invoiceNumber}
                  </Link>
                </DetailItem>
              )}
              {payment.gatewayPaymentId && (
                <DetailItem label="Payment ID">
                  <span className="font-mono text-xs">{payment.gatewayPaymentId}</span>
                </DetailItem>
              )}
              {payment.status === "failed" && payment.failureReason && <DetailItem label="Reason">{payment.failureReason}</DetailItem>}
              {payment.refundedAt && (
                <DetailItem label="Refunded">
                  {money(payment.refundedAmount ?? payment.amount, payment.currency)} · {formatDateTime(payment.refundedAt)}
                </DetailItem>
              )}
              {(payment.gstin || payment.pan) && (
                <DetailItem label="GSTIN / PAN">
                  {payment.gstin ?? "—"} / {payment.pan ?? "—"}
                </DetailItem>
              )}
              {payment.buyerVatId && (
                <DetailItem label="VAT number">
                  <span className="font-mono" dir="ltr">
                    {payment.buyerVatId}
                  </span>
                  {payment.reverseCharge && <span className="ms-2 text-ink-muted">Reverse charge: no VAT charged</span>}
                </DetailItem>
              )}
            </dl>
          </section>
        </div>

        <aside className="lg:sticky lg:top-20">
          <OrderSummary
            itemType={payment.itemType}
            title={item ? (payment.itemType === "certificate" ? item.name : item.title) : payment.itemTitle}
            subtitle={payment.itemType === "certificate" ? "Certificate of completion" : item?.description}
            imageUrl={item?.imageUrl}
            gradient={item?.gradient}
            lines={{
              currency: payment.currency,
              originalAmount: payment.originalAmount,
              discountAmount: payment.discountAmount,
              taxAmount: payment.taxAmount,
              taxLabel: (payment.taxCountry && db.taxRules.find((r) => r.country.toUpperCase() === payment.taxCountry?.toUpperCase())?.name) || settings.commerce.taxLabel,
              taxPercentage: payment.taxRate,
              taxInclusive: isTaxInclusive(payment),
              total: payment.amount,
              couponCode: payment.couponCode,
            }}
          />
        </aside>
      </div>
    </>
  );
}
